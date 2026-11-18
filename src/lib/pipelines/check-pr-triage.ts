/**
 * `check-pr-triage` — the PR suggestion's **Check if needed** button. One cheap
 * child per PR reads the conversation around the comments proposed for triage
 * and says which are already addressed; those leave the proposal. Nothing is
 * written to GitHub or the worktree.
 */

import { saveTriageVerdicts, type TriageVerdict } from "@/lib/db/pr-watch";
import { prSuggestionInput } from "@/lib/pr-watcher";
import { triageCandidates } from "@/lib/pr-watcher/suggestions";
import { buildPrTriageJudgePrompt, PR_TRIAGE_JUDGE_SCHEMA } from "@/lib/templates/prompts/pr-triage-judge";
import { runGit } from "@/lib/workspace/git-exec";
import { listWorkspacePullRequests } from "@/lib/workspace/pr-threads";
import { STEP_TYPES, type GroupChild, type PipelinePhase } from "@/types/pipeline";

const MAX_COMMITS = 30;

/** One verdict per target, in target order; anything missing or unreadable stays open. */
export function parseTriageVerdicts(raw: string, targetUrls: string[]): TriageVerdict[] {
  let results: unknown;
  try {
    results = (JSON.parse(raw) as { results?: unknown }).results;
  } catch {
    results = [];
  }
  const byUrl = new Map<string, { verdict?: unknown; reason?: unknown }>();
  if (Array.isArray(results)) {
    for (const r of results) if (typeof r?.url === "string") byUrl.set(r.url, r);
  }
  return targetUrls.map((url) => {
    const r = byUrl.get(url);
    if (!r) return { url, verdict: "open", reason: "No verdict returned" };
    return {
      url,
      verdict: r.verdict === "addressed" ? "addressed" : "open",
      reason: typeof r.reason === "string" ? r.reason.trim() : "",
    };
  });
}

export function buildCheckPrTriagePipeline(input: { workspace: string }): PipelinePhase[] {
  const { workspace } = input;
  return [
    {
      kind: "function",
      label: "Check whether triage is needed",
      timeoutMs: 10 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const suggestionInput = await prSuggestionInput(workspace);
        const candidates = triageCandidates(suggestionInput);
        if (candidates.length === 0) {
          ctx.emitResult("No comments are proposed for triage.");
          return true;
        }

        ctx.emitStatus(`Reading pull requests for ${workspace}...`);
        const { pullRequests, problems } = await listWorkspacePullRequests(workspace);
        for (const p of problems) ctx.emitStatus(`${p.repoName}: ${p.reason}`);

        const jobs = await Promise.all(
          pullRequests.map(async (pr) => {
            const onPr = new Set(pr.threads.flatMap((t) => t.comments.map((c) => c.url)));
            const targetUrls = candidates.filter((e) => e.prUrl === pr.url && onPr.has(e.url!)).map((e) => e.url!);
            if (targetUrls.length === 0) return null;
            const log = await runGit(
              ["log", `-${MAX_COMMITS}`, "--format=%cI %h %s", `origin/${pr.baseRefName}..HEAD`],
              pr.worktreePath,
            );
            return { pr, targetUrls, commits: log.ok ? log.out : "" };
          }),
        );
        const targets = jobs.filter((j) => j !== null);
        if (targets.length === 0) {
          ctx.emitResult("The comments proposed for triage are no longer on the open PRs.");
          return true;
        }

        const answers = new Map<string, string>();
        const children: GroupChild[] = targets.map(({ pr, targetUrls, commits }) => ({
          label: `judge-${pr.repoName}`,
          prompt: buildPrTriageJudgePrompt({
            prUrl: pr.url,
            prTitle: pr.title,
            self: suggestionInput.self,
            threads: pr.threads,
            targetUrls,
            commits,
          }),
          jsonSchema: PR_TRIAGE_JUDGE_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.JUDGE_PR_TRIAGE,
          skipAskUserQuestion: true,
          onResultText: (text) => { answers.set(pr.url, text); },
        }));
        ctx.emitStatus(`Judging ${candidates.length} comment(s) on ${children.length} PR(s)...`);
        await ctx.runChildGroup(children);

        const verdicts = targets.flatMap(({ pr, targetUrls }) => parseTriageVerdicts(answers.get(pr.url) ?? "", targetUrls));
        saveTriageVerdicts(workspace, verdicts);

        const addressed = verdicts.filter((v) => v.verdict === "addressed");
        const open = verdicts.filter((v) => v.verdict === "open");
        const line = (v: TriageVerdict) => `- ${v.url}\n  - ${v.reason}`;
        ctx.emitResult(
          [
            `${addressed.length} of ${verdicts.length} comment(s) judged already addressed and dropped from the triage proposal.`,
            ...(addressed.length ? ["\n**Addressed**", ...addressed.map(line)] : []),
            ...(open.length ? ["\n**Still needs triage**", ...open.map(line)] : []),
          ].join("\n"),
        );
        return true;
      },
    },
  ];
}
