import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { postReviewCommentsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { postReviewComments } from "@/lib/workspace/pr-review-comments";
import { loadReviewFindings, reviewDirPath } from "@/lib/workspace/review-findings";
import type {
  AnchoredReviewFinding,
  PostCommentsResponse,
  PostedFindingResult,
} from "@/types/review-findings";

export const dynamic = "force-dynamic";

/**
 * Post the selected findings on their repositories' pull requests.
 *
 * A plain route rather than a pipeline operation: there is no agent in it — the
 * findings are already written and the human already chose — and the result
 * belongs on the screen they chose from, not in an operation log.
 *
 * The request carries ids and edited bodies only. Everything that decides *where*
 * a comment lands is re-read from the review's own findings file here, so the
 * client cannot aim one at a location the reviewer never named.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string; timestamp: string }> },
) {
  try {
    const { name: rawName, timestamp: rawTimestamp } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const timestamp = decodeURIComponent(rawTimestamp);
    if (timestamp.includes("..") || timestamp.includes("/") || timestamp.includes("\\")) {
      return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
    }
    if (!existsSync(reviewDirPath(name, timestamp))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(postReviewCommentsSchema, body);
    if (!parsed.success) return parsed.response;

    const { repos } = await loadReviewFindings(name, timestamp);
    const worktrees = new Map(
      listWorkspaceRepos(name).map((r) => [r.repoName, r.worktreePath]),
    );

    const byId = new Map<string, AnchoredReviewFinding>();
    for (const repo of repos) {
      for (const finding of repo.findings) byId.set(finding.id, finding);
    }

    const bodies: Record<string, string> = {};
    const selected = new Map<string, AnchoredReviewFinding[]>();
    const results: PostedFindingResult[] = [];

    for (const requested of parsed.data.findings) {
      const finding = byId.get(requested.id);
      if (!finding) {
        // The review was re-run, or the file changed under the open tab.
        results.push({
          id: requested.id,
          status: "failed",
          reason: "no longer among this review's findings",
        });
        continue;
      }
      if (requested.body !== undefined && requested.body.trim() !== "") {
        bodies[finding.id] = requested.body;
      }
      const group = selected.get(finding.repoName) ?? [];
      group.push(finding);
      selected.set(finding.repoName, group);
    }

    const reviews: PostCommentsResponse["reviews"] = [];

    for (const [repoName, findings] of selected) {
      const repo = repos.find((r) => r.repoName === repoName);
      const worktreePath = worktrees.get(repoName);
      const fail = (reason: string) => {
        reviews.push({ repoName, reviewUrl: null, pending: false, problem: reason });
        for (const f of findings) results.push({ id: f.id, status: "failed", reason });
      };

      if (!repo?.pr || !worktreePath) {
        fail("this repository's branch has no pull request to comment on");
        continue;
      }
      // GitHub allows one pending review per user per PR, so a leftover one would
      // make the request 422. Saying which state to clear beats relaying that.
      if (repo.pr.hasPendingReview) {
        fail(
          "a pending review already exists on this PR — submit or discard it on GitHub first",
        );
        continue;
      }

      try {
        const result = await postReviewComments({
          pr: repo.pr,
          worktreePath,
          findings,
          bodies,
          submit: parsed.data.submit === true,
        });
        reviews.push({
          repoName,
          reviewUrl: result.reviewUrl,
          pending: result.pending,
          problem: null,
        });
        results.push(...result.results);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    }

    const response: PostCommentsResponse = { reviews, results };
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
