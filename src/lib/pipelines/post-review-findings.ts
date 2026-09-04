/**
 * `post-review-findings` — the operation behind the review tab's **Post** button.
 *
 * The human's selection is a set of *candidates*, not a set of comments. Each
 * selected finding gets a read-only grounding child that checks the reviewer's
 * claim against the pushed code and decides whether it deserves a comment at all;
 * a trailing deterministic phase posts the ones that survive, one review per
 * repository. Nobody reads the verdicts in between — that is the point, and it is
 * what the grounder's prompt is biased around.
 *
 * The split matters. The children never post: they have no write tools and no
 * `gh api` reach, and the phase does the posting from their structured output.
 * That keeps one review per repository instead of one notification per finding,
 * keeps the marker-based idempotency in one place, and means an agent is never
 * holding a mutation on someone else's pull request.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import {
  buildFindingGrounderPrompt,
  FINDING_GROUNDING_SCHEMA,
} from "@/lib/templates/prompts/finding-grounder";
import {
  normalizeHolds,
  normalizeScope,
  shouldPost,
  writeFindingGroundings,
} from "@/lib/workspace/finding-groundings";
import { appendKnownFindings } from "@/lib/workspace/known-findings";
import type { KnownFinding } from "@/lib/workspace/known-findings";
import { postReviewComments } from "@/lib/workspace/pr-review-comments";
import { loadReviewFindings } from "@/lib/workspace/review-findings";
import { listWorkspacePullRequests } from "@/lib/workspace/pr-threads";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhase } from "@/types/pipeline";
import type { AnchoredReviewFinding, FindingGrounding } from "@/types/review-findings";

export const POST_REVIEW_FINDINGS_PHASE_LABEL = "Ground and post findings";

/** Comments quoted to the grounder as the sample of a repo's conventions. */
const MAX_CONVENTION_SAMPLES = 6;
const MAX_CONVENTION_CHARS = 1200;

/**
 * Budget for the whole phase.
 *
 * Per selected finding rather than flat, for the same reason
 * `validatePrCommentsBudgetMs` is: the children run concurrently, but the
 * concurrency cap makes a large selection queue, and a budget sized for one
 * finding would kill the tail and re-run all of it on the same budget.
 */
export function postReviewFindingsBudgetMs(findingCount: number): number {
  const PER_FINDING_MS = 4 * 60 * 1000;
  const BASE_MS = 5 * 60 * 1000;
  return BASE_MS + Math.max(1, findingCount) * PER_FINDING_MS;
}

/**
 * One child's structured output as a stored grounding.
 *
 * Returns null when there is no verdict in it. A child that died or answered in
 * prose has not judged anything, and recording that as `unclear` would put a
 * considered-looking answer on the record — where the tab would show it as a
 * decision and a re-run would not revisit it.
 */
export function parseGroundingResult(
  raw: string,
  context: { findingId: string; repoName: string; groundedAt: string },
): FindingGrounding | null {
  if (!raw.trim()) return null;

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  if (!str(json.holds)) return null;

  return {
    findingId: context.findingId,
    repoName: context.repoName,
    holds: normalizeHolds(str(json.holds)),
    scope: normalizeScope(str(json.scope)),
    evidence: Array.isArray(json.evidence)
      ? json.evidence.filter((e): e is string => typeof e === "string")
      : [],
    comment: str(json.comment),
    reason: str(json.reason),
    // Set by the posting phase; a verdict on its own has not reached GitHub.
    posted: false,
    groundedAt: context.groundedAt,
  };
}

/**
 * The declined findings, as ledger entries for the next review.
 *
 * Without this the ledger has no writer outside the autonomous gate, so a
 * workspace that only ever reviews — a PR-review workspace, or any review a
 * human starts — re-derives and re-reports at full length exactly the findings
 * a grounding pass already checked and dropped. `RECURRING_FINDINGS_POLICY`
 * compresses a listed finding to one line, which is what this buys.
 *
 * The filter is `shouldPost`, not `posted`: a finding that earned a comment and
 * failed to reach GitHub is still an ask the human wants made, and recording it
 * here would tell the next reviewer to stop mentioning it. Only what the
 * grounding pass itself declined goes in.
 */
export function knownFindingsFromGroundings(
  entries: { grounding: FindingGrounding; title: string }[],
): KnownFinding[] {
  const findings: KnownFinding[] = [];

  for (const { grounding, title } of entries) {
    if (shouldPost(grounding)) continue;
    const summary = title.trim();
    if (summary === "") continue;
    const reason = grounding.reason.trim() || "no reason recorded";

    if (grounding.holds === "no") {
      findings.push({
        summary,
        kind: "low-confidence",
        reason: `Checked against the pushed code and refuted: ${reason}`,
      });
    } else if (grounding.holds === "unclear") {
      findings.push({
        summary,
        kind: "low-confidence",
        reason: `The code could not settle the claim: ${reason}`,
      });
    } else if (grounding.scope === "local-only") {
      findings.push({
        summary,
        kind: "pre-existing",
        reason: `Reproduces only from local state, not from the pushed branch: ${reason}`,
      });
    } else if (grounding.scope === "pre-existing") {
      findings.push({
        summary,
        kind: "pre-existing",
        reason: `Real, but not introduced by this branch: ${reason}`,
      });
    }
    // `yes` + `pr` with an empty comment is the remaining case: the grounder
    // confirmed the finding and wrote nothing to say about it, which is not a
    // decision to stop reporting it.
  }

  return findings;
}

/** One line naming what went out and what each dropped finding was dropped for. */
export function summarizeGroundings(groundings: FindingGrounding[]): string {
  const posted = groundings.filter((g) => g.posted).length;
  const refuted = groundings.filter((g) => g.holds === "no").length;
  const unclear = groundings.filter((g) => g.holds === "unclear").length;
  const localOnly = groundings.filter(
    (g) => g.holds === "yes" && g.scope === "local-only",
  ).length;
  const preExisting = groundings.filter(
    (g) => g.holds === "yes" && g.scope === "pre-existing",
  ).length;

  const parts = [
    posted > 0 ? `${posted} posted` : null,
    refuted > 0 ? `${refuted} refuted` : null,
    localOnly > 0 ? `${localOnly} local-only` : null,
    preExisting > 0 ? `${preExisting} pre-existing` : null,
    unclear > 0 ? `${unclear} unclear` : null,
  ].filter(Boolean);

  if (posted === 0) {
    return `No comment was posted${parts.length > 0 ? ` — ${parts.join(", ")}` : ""}.`;
  }
  return parts.join(", ");
}

/**
 * The repository's own review comments, as the sample the grounder matches.
 *
 * Deliberately bounded: this is evidence of language and register, not the
 * discussion. A long thread would crowd out the finding being judged.
 */
function conventionSamples(
  comments: { author: string; body: string }[],
): { author: string; body: string }[] {
  const samples: { author: string; body: string }[] = [];
  let budget = MAX_CONVENTION_CHARS;
  for (const comment of comments) {
    if (samples.length >= MAX_CONVENTION_SAMPLES || budget <= 0) break;
    const body = comment.body.slice(0, budget);
    if (body.trim() === "") continue;
    samples.push({ author: comment.author, body });
    budget -= body.length;
  }
  return samples;
}

export function buildPostReviewFindingsPipeline(input: {
  workspace: string;
  reviewTimestamp: string;
  findingIds: string[];
  submit: boolean;
}): PipelinePhase[] {
  const { workspace, reviewTimestamp, findingIds, submit } = input;
  const wanted = new Set(findingIds);

  return [
    {
      kind: "function",
      label: POST_REVIEW_FINDINGS_PHASE_LABEL,
      timeoutMs: postReviewFindingsBudgetMs(findingIds.length),
      // A retry re-grounds every finding on the same budget, and anything already
      // posted would be skipped by its marker while the rest cost a second full
      // fan-out. The button is one click away.
      maxRetries: 0,
      fn: async (ctx) => {
        const wsPath = path.join(getWorkspaceDir(), workspace);

        ctx.emitStatus(`Reading findings from review ${reviewTimestamp}...`);
        const { repos } = await loadReviewFindings(workspace, reviewTimestamp);
        // `RepoReviewFindings` does not carry the worktree path — it is sent to
        // the browser — so it is resolved from the same list the findings came
        // from.
        const worktrees = new Map(
          listWorkspaceRepos(workspace).map((r) => [
            r.repoName,
            { worktreePath: r.worktreePath, repoPath: r.repoPath },
          ]),
        );

        // Existing PR comments, for the conventions the grounder writes in. A
        // failure here costs the style sample, not the run.
        const commentsByRepo = new Map<string, { author: string; body: string }[]>();
        try {
          const { pullRequests } = await listWorkspacePullRequests(workspace);
          for (const pr of pullRequests) {
            commentsByRepo.set(
              pr.repoName,
              pr.threads.flatMap((t) => t.comments.map((c) => ({ author: c.author, body: c.body }))),
            );
          }
        } catch (err) {
          ctx.emitStatus(
            `Could not read existing PR comments for convention samples: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        const targets: { finding: AnchoredReviewFinding; repo: (typeof repos)[number] }[] = [];
        for (const repo of repos) {
          if (!repo.pr) continue;
          for (const finding of repo.findings) {
            if (wanted.has(finding.id) && !finding.posted) targets.push({ finding, repo });
          }
        }

        const missing = [...wanted].filter((id) => !targets.some((t) => t.finding.id === id));
        if (missing.length > 0) {
          ctx.emitStatus(
            `${missing.length} selected finding(s) were skipped — already posted, or their repository has no PR`,
          );
        }
        if (targets.length === 0) {
          ctx.emitResult(
            "None of the selected findings can be posted: they are already on their PRs, or their repositories have no pull request.",
          );
          return false;
        }

        const systemPromptFile = ensureSystemPrompt(wsPath, "finding-grounder");
        const resultTexts = new Map<string, string>();

        const children: GroupChild[] = targets.map(({ finding, repo }) => {
          const worktreePath = worktrees.get(repo.repoName)?.worktreePath ?? "";
          return {
          label: `ground-${repo.repoName}-${finding.path}:${finding.line ?? "file"}`,
          prompt: buildFindingGrounderPrompt({
            workspaceName: workspace,
            repoName: repo.repoName,
            repoPath: worktrees.get(repo.repoName)?.repoPath ?? repo.repoName,
            worktreePath,
            baseBranch: repo.pr?.baseRefName || "main",
            prUrl: repo.pr?.url ?? "",
            finding,
            conventionSamples: conventionSamples(commentsByRepo.get(repo.repoName) ?? []),
          }),
          cwd: worktreePath,
          addDirs: [worktreePath],
          // Read-only by construction, not by prompt alone: setting `allowedTools`
          // at all replaces the Edit/Write grants `addDirs` would generate, and
          // `gh` narrowed to `pr view` puts every mutation out of reach. The
          // posting is this phase's job.
          allowedTools: ["Bash(git:*)", "Bash(gh pr view:*)"],
          jsonSchema: FINDING_GROUNDING_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.GROUND_FINDING,
          appendSystemPromptFile: systemPromptFile,
          skipAskUserQuestion: true,
          onResultText: (text) => { resultTexts.set(finding.id, text); },
          };
        });

        ctx.emitStatus(`Grounding ${children.length} finding(s) against the pushed code...`);
        await ctx.runChildGroup(children);

        const groundedAt = new Date().toISOString();
        const groundings: FindingGrounding[] = [];
        const unreadable: string[] = [];

        for (const { finding, repo } of targets) {
          const parsed = parseGroundingResult(resultTexts.get(finding.id) ?? "", {
            findingId: finding.id,
            repoName: repo.repoName,
            groundedAt,
          });
          if (parsed) groundings.push(parsed);
          else unreadable.push(`${repo.repoName} ${finding.path}:${finding.line ?? "file"}`);
        }

        // Group what survived by repository: one review each, so a reviewer gets
        // one notification per repo rather than one per finding.
        const approved = new Map<string, AnchoredReviewFinding[]>();
        const comments: Record<string, string> = {};
        for (const grounding of groundings) {
          if (!shouldPost(grounding)) continue;
          const target = targets.find((t) => t.finding.id === grounding.findingId);
          if (!target) continue;
          comments[grounding.findingId] = grounding.comment;
          const group = approved.get(grounding.repoName) ?? [];
          group.push(target.finding);
          approved.set(grounding.repoName, group);
        }

        const lines: string[] = [];

        for (const [repoName, findings] of approved) {
          const repo = repos.find((r) => r.repoName === repoName);
          if (!repo?.pr) continue;
          if (repo.pr.hasPendingReview) {
            // GitHub allows one pending review per user per PR, so the request
            // would be rejected. Name the state to clear instead.
            lines.push(
              `- **${repoName}**: not posted — a pending review already exists on the PR. Submit or discard it on GitHub, then post again.`,
            );
            continue;
          }

          try {
            const result = await postReviewComments({
              pr: repo.pr,
              worktreePath: worktrees.get(repoName)?.worktreePath ?? "",
              findings,
              comments,
              submit,
            });
            for (const posted of result.results) {
              if (posted.status !== "posted") continue;
              const grounding = groundings.find((g) => g.findingId === posted.id);
              if (grounding) grounding.posted = true;
            }
            const failed = result.results.filter((r) => r.status === "failed");
            lines.push(
              `- **${repoName}**: ${result.results.filter((r) => r.status === "posted").length} comment(s) ${
                result.pending ? "in a pending review" : "submitted"
              }${result.reviewUrl ? ` — ${result.reviewUrl}` : ""}${
                failed.length > 0 ? ` (${failed.length} failed)` : ""
              }`,
            );
          } catch (err) {
            lines.push(
              `- **${repoName}**: posting failed — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        if (groundings.length > 0) await writeFindingGroundings(wsPath, groundings);

        // Hand the declined findings to the next review, so it compresses them
        // instead of re-deriving them at full length.
        let ledgered: KnownFinding[] = [];
        if (groundings.length > 0) {
          const titles = new Map(targets.map((t) => [t.finding.id, t.finding.title]));
          ledgered = await appendKnownFindings(
            wsPath,
            knownFindingsFromGroundings(
              groundings.map((grounding) => ({
                grounding,
                title: titles.get(grounding.findingId) ?? "",
              })),
            ),
          );
          if (ledgered.length > 0) {
            ctx.emitStatus(
              `Recorded ${ledgered.length} declined finding(s) in the known-findings ledger`,
            );
          }
        }

        const dropped = groundings.filter((g) => !g.posted);
        const report = [
          `Grounded ${groundings.length} of ${targets.length} selected finding(s): ${summarizeGroundings(groundings)}`,
          ...(lines.length > 0 ? ["", ...lines] : []),
          ...(dropped.length > 0
            ? [
                "",
                "Not posted:",
                ...dropped.map(
                  (g) =>
                    `- \`${g.findingId}\` (${g.holds === "yes" ? g.scope : g.holds}) — ${g.reason || "no reason given"}`,
                ),
              ]
            : []),
          ...(ledgered.length > 0
            ? [
                "",
                `${ledgered.length} declined finding(s) went to \`artifacts/known-findings.md\`, so the next review reports them as one \`(Recurring)\` line rather than deriving them again.`,
              ]
            : []),
          ...(unreadable.length > 0
            ? [
                "",
                `No verdict returned for: ${unreadable.join(", ")}. Those findings were left untouched — post them again to retry.`,
              ]
            : []),
        ].join("\n");

        ctx.emitResult(report);

        // A run that grounded everything and posted nothing did its job: the
        // findings did not survive checking. Only a total absence of verdicts is
        // a failed phase.
        return groundings.length > 0;
      },
    },
  ];
}
