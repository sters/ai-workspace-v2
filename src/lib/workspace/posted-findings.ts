/**
 * The findings this workspace has already put on its pull requests, restated as
 * asks a later review can check.
 *
 * A finding that was grounded and posted is an outstanding request to the PR's
 * author. Re-reviewing without it asks the wrong question — "is this code
 * good?" — of a branch whose author has, in between, been answering "did you do
 * what I asked?". `review.ts` already has the machinery for the second
 * question: `requestedFixes` spawns the fix verifier, which reports
 * LANDED / PARTIAL / NOT LANDED per ask out of the code. This module supplies
 * that list for a manual re-review, the way the autonomous gate's
 * `fixableIssues` supplies it inside a cycle.
 *
 * The two sources are kept separate and never merged: a gate ask is one the gate
 * may later retire, while these were written by a human onto someone else's PR
 * and only the author can settle them.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { readFindingGroundings } from "./finding-groundings";
import { listWorkspaceRepos } from "./git";
import { readRepoFindings } from "./review-findings";
import type { FindingGrounding, ReviewFinding } from "@/types/review-findings";

/** The posted comment is quoted so the verifier checks the ask that was actually made, not a paraphrase. */
const MAX_COMMENT_CHARS = 800;

function quote(text: string): string {
  const trimmed =
    text.length > MAX_COMMENT_CHARS ? `${text.slice(0, MAX_COMMENT_CHARS).trimEnd()}…` : text;
  return trimmed
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * One ask, as the fix verifier will read it.
 *
 * The location comes from the finding and the wording from the grounding: the
 * finding says where to look, and the comment is what the author was asked for.
 * A finding whose review session has since been pruned still yields an ask from
 * the comment alone — the ask is on the PR either way.
 */
export function formatPostedAsk(input: {
  grounding: FindingGrounding;
  finding: ReviewFinding | undefined;
}): string {
  const { grounding, finding } = input;
  const location = finding
    ? `${finding.path}:${finding.line ?? "(file)"} — ${finding.title}`
    : `(the review session that recorded finding ${grounding.findingId} is no longer on disk)`;
  const when = grounding.groundedAt ? ` on ${grounding.groundedAt.slice(0, 10)}` : "";

  return [
    location,
    `Posted as a review comment on this repository's PR${when}. The comment read:`,
    quote(grounding.comment.trim() || finding?.body || "(the comment text was not recorded)"),
  ].join("\n");
}

/**
 * Posted findings grouped by repository, as ask strings.
 *
 * Grouped rather than flat because each repository's verifier should be handed
 * its own asks: a verifier reading another repo's comment can only report it as
 * absent. Sorted by path and line so the numbering the verifier's report uses is
 * stable between runs.
 */
export function buildPostedAsks(
  groundings: Record<string, FindingGrounding>,
  findingsById: Map<string, ReviewFinding>,
): Map<string, string[]> {
  const entries = Object.values(groundings)
    .filter((g) => g.posted)
    .map((grounding) => ({ grounding, finding: findingsById.get(grounding.findingId) }))
    .sort((a, b) => {
      const pathA = a.finding?.path ?? "";
      const pathB = b.finding?.path ?? "";
      if (pathA !== pathB) return pathA.localeCompare(pathB);
      return (a.finding?.line ?? 0) - (b.finding?.line ?? 0);
    });

  const byRepo = new Map<string, string[]>();
  for (const entry of entries) {
    const repoName = entry.grounding.repoName || entry.finding?.repoName || "";
    if (repoName === "") continue;
    const asks = byRepo.get(repoName) ?? [];
    asks.push(formatPostedAsk(entry));
    byRepo.set(repoName, asks);
  }
  return byRepo;
}

/** Review session directory names, newest first. */
function listReviewTimestamps(wsPath: string): string[] {
  const reviewsDir = path.join(wsPath, "artifacts", "reviews");
  if (!existsSync(reviewsDir)) return [];
  try {
    return readdirSync(reviewsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/**
 * Every posted finding in the workspace, by repository.
 *
 * The findings themselves live in the review session that produced them, so the
 * sessions are walked newest-first until every posted id is accounted for. Ids
 * are content hashes, so the same finding re-reported by a later review resolves
 * to the same entry — which is why the newest session wins and why the walk can
 * stop early.
 */
export async function collectPostedAsks(workspace: string): Promise<Map<string, string[]>> {
  const wsPath = path.join(getWorkspaceDir(), workspace);
  const store = await readFindingGroundings(wsPath);
  const postedIds = new Set(
    Object.values(store.groundings).filter((g) => g.posted).map((g) => g.findingId),
  );
  if (postedIds.size === 0) return new Map();

  const repos = listWorkspaceRepos(workspace);
  const findingsById = new Map<string, ReviewFinding>();

  for (const timestamp of listReviewTimestamps(wsPath)) {
    const reviewDir = path.join(wsPath, "artifacts", "reviews", timestamp);
    for (const repo of repos) {
      const findings = await readRepoFindings(reviewDir, repo.repoPath, repo.repoName);
      for (const finding of findings) {
        if (postedIds.has(finding.id) && !findingsById.has(finding.id)) {
          findingsById.set(finding.id, finding);
        }
      }
    }
    if (findingsById.size === postedIds.size) break;
  }

  return buildPostedAsks(store.groundings, findingsById);
}
