/**
 * Posting selected review findings on a PR as inline comments.
 *
 * Everything goes out as **one review** (`POST /pulls/{n}/reviews` with a
 * `comments` array) rather than one comment at a time: the per-comment endpoint
 * would notify the PR's watchers once per finding, which is the spam the human's
 * selection exists to avoid in the first place.
 *
 * By default the review is left **pending** — `event` omitted — so the last step
 * before it reaches someone else's PR is still a human pressing submit on
 * GitHub. That is also why idempotency is taken from GitHub rather than from a
 * local record: each posted comment carries an invisible marker naming the
 * finding it came from, and a finding whose marker is already on the PR is
 * skipped. A local "posted" flag would drift the moment anyone deleted a comment.
 */

import { getCleanEnv } from "@/lib/env";
import { execArgs } from "./helpers";
import { parsePrLocator } from "./pr-threads";
import type {
  AnchoredReviewFinding,
  FindingsTargetPr,
  PostCommentsResult,
  PostedFindingResult,
} from "@/types/review-findings";

const GH_TIMEOUT_MS = 60_000;

/** Well past what any PR carries, and one page — see `extractPostedIds`. */
const PER_PAGE = 100;

/**
 * The tag that ties a posted comment back to the finding it came from.
 *
 * An HTML comment, so it is invisible in the rendered comment while staying in
 * the body GitHub hands back on a read.
 */
export function findingMarker(id: string): string {
  return `<!-- aiw-finding:${id} -->`;
}

/**
 * Finding ids already commented on this PR.
 *
 * Scans the raw response text for markers instead of walking parsed JSON, which
 * makes it indifferent to how `gh` frames a paginated result — several
 * concatenated arrays parse as nothing, and a missed page would mean a duplicate
 * comment.
 */
export function extractPostedIds(raw: string): Set<string> {
  const ids = new Set<string>();
  for (const match of raw.matchAll(/aiw-finding:([0-9a-zA-Z_-]+)/g)) ids.add(match[1]);
  return ids;
}

/**
 * The id of a pending review on this PR, if there is one.
 *
 * GitHub allows a user only one pending review per PR, so a leftover one has to
 * be found before a post is attempted — the request would be rejected otherwise,
 * and "submit or discard the one you already have" is a more useful thing to say
 * than a raw 422. Other users' pending reviews are invisible to this call, so
 * anything it finds is ours.
 */
export function parsePendingReviewId(raw: string): number | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  for (const entry of json) {
    const review = entry as Record<string, unknown>;
    if (review.state === "PENDING" && typeof review.id === "number") return review.id;
  }
  return null;
}

/**
 * The comment as it will appear on the PR.
 *
 * `comment` is the grounding pass's own text, written in the repository's
 * convention, and nothing is prepended to it: an English severity label or a
 * `(confidence: low)` note would undo exactly what that pass is for. Urgency is
 * the comment's own job to convey, in the repository's words.
 *
 * The two additions are mechanical. A location line, only when the comment could
 * not be anchored to the line it is about — a file-level or body comment has lost
 * it, and without it the reader cannot find what is being discussed. And the
 * marker, which is how a re-run knows this finding is already on the PR.
 */
export function buildCommentBody(
  finding: AnchoredReviewFinding,
  comment: string,
): string {
  const lines: string[] = [];
  if (finding.anchor !== "inline") {
    lines.push(
      `\`${finding.path}${finding.line !== null ? `:${finding.line}` : ""}\``,
      "",
    );
  }
  lines.push(comment.trim());
  if (finding.suggestion) {
    lines.push("", "```suggestion", finding.suggestion, "```");
  }
  lines.push("", findingMarker(finding.id));
  return lines.join("\n");
}

export interface ReviewCommentPayload {
  path: string;
  body: string;
  side?: "RIGHT" | "LEFT";
  line?: number;
  start_line?: number;
  start_side?: "RIGHT" | "LEFT";
  subject_type?: "file";
}

export interface ReviewPayload {
  commit_id: string;
  body: string;
  /** Omitted leaves the review pending; `COMMENT` submits it immediately. */
  event?: "COMMENT";
  comments: ReviewCommentPayload[];
}

/**
 * Turn the selected findings into one review request.
 *
 * Every finding gets a result, including the ones that produce no comment, so the
 * caller can report each selection's fate rather than a count.
 */
export function buildReviewPayload(input: {
  findings: AnchoredReviewFinding[];
  /** The grounding pass's comment per finding id. A finding without one is not posted. */
  comments: Record<string, string>;
  commitSha: string;
  submit: boolean;
}): { payload: ReviewPayload; results: PostedFindingResult[]; hasContent: boolean } {
  const comments: ReviewCommentPayload[] = [];
  const bodyFindings: string[] = [];
  const results: PostedFindingResult[] = [];

  for (const finding of input.findings) {
    if (finding.posted) {
      results.push({
        id: finding.id,
        status: "skipped",
        reason: "already commented on this PR",
      });
      continue;
    }

    const grounded = input.comments[finding.id];
    if (grounded === undefined || grounded.trim() === "") {
      // The grounding pass decides what gets posted, so a finding it wrote no
      // comment for is not one to fall back to the reviewer's own wording on.
      results.push({
        id: finding.id,
        status: "failed",
        reason: "no grounded comment was produced for this finding",
      });
      continue;
    }

    const body = buildCommentBody(finding, grounded);

    if (finding.anchor === "pr-body") {
      bodyFindings.push(`- ${body.split("\n").filter((l) => l !== "").join(" ")}`);
      results.push({ id: finding.id, status: "posted" });
      continue;
    }

    if (finding.anchor === "file") {
      comments.push({ path: finding.path, subject_type: "file", body });
      results.push({ id: finding.id, status: "posted" });
      continue;
    }

    const comment: ReviewCommentPayload = {
      path: finding.path,
      line: finding.line as number,
      side: finding.side,
      body,
    };
    if (finding.startLine !== null && finding.line !== null && finding.startLine < finding.line) {
      comment.start_line = finding.startLine;
      comment.start_side = finding.side;
    }
    comments.push(comment);
    results.push({ id: finding.id, status: "posted" });
  }

  const bodyParts = ["Review findings from ai-workspace."];
  if (bodyFindings.length > 0) {
    // These name files the PR does not touch, so GitHub would reject them at any
    // anchor level. The body is the one place they still reach the reader.
    bodyParts.push("", "#### Findings outside this PR's diff", ...bodyFindings);
  }

  const payload: ReviewPayload = {
    commit_id: input.commitSha,
    body: bodyParts.join("\n"),
    comments,
  };
  if (input.submit) payload.event = "COMMENT";

  return {
    payload,
    results,
    hasContent: comments.length > 0 || bodyFindings.length > 0,
  };
}

async function runGh(args: string[], cwd: string, stdin?: string): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: getCleanEnv(),
  });
  const timer = setTimeout(() => proc.kill(), GH_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `gh exited ${exitCode}`);
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

const PR_FIELDS = "number,url,baseRefName,headRefOid";

/**
 * The PR a repository's findings would be posted to, or null when its branch has
 * none.
 *
 * `headRefOid` is compared against the worktree's HEAD because the anchors are
 * resolved against the *local* diff: if the branch moved on the remote, the line
 * numbers this dashboard computed are not the ones GitHub will apply.
 */
export async function readFindingsTargetPr(repo: {
  repoName: string;
  worktreePath: string;
}): Promise<{ pr: FindingsTargetPr | null; problem: string | null }> {
  let raw: string;
  try {
    raw = execArgs(["gh", "pr", "view", "--json", PR_FIELDS], { cwd: repo.worktreePath });
  } catch (err) {
    return {
      pr: null,
      problem: `No pull request readable for this branch: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { pr: null, problem: "Could not read PR details from gh" };
  }

  const locator = parsePrLocator(typeof json.url === "string" ? json.url : "");
  if (!locator) return { pr: null, problem: "gh returned a PR without a usable url" };

  const headSha = typeof json.headRefOid === "string" ? json.headRefOid : "";
  let localHead = "";
  try {
    localHead = execArgs(["git", "rev-parse", "HEAD"], { cwd: repo.worktreePath });
  } catch {
    // Leave it empty: an unreadable local HEAD is reported as a stale worktree
    // rather than silently claimed to match.
  }

  const pr: FindingsTargetPr = {
    repoName: repo.repoName,
    url: json.url as string,
    number: typeof json.number === "number" ? json.number : locator.number,
    host: locator.host,
    owner: locator.owner,
    repo: locator.repo,
    baseRefName: typeof json.baseRefName === "string" ? json.baseRefName : "",
    headSha,
    staleWorktree: headSha === "" || localHead === "" || headSha !== localHead,
    hasPendingReview: false,
  };

  return { pr, problem: null };
}

function apiArgs(pr: FindingsTargetPr, path: string, extra: string[] = []): string[] {
  return [
    "gh", "api",
    "--hostname", pr.host,
    `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}${path}`,
    ...extra,
  ];
}

/**
 * Which findings are already on the PR, and whether a pending review is in the
 * way.
 *
 * A pending review's comments are not returned by the PR's comment list — only
 * by the review's own — so both are read, or a finding sitting in an
 * unsubmitted review would be offered again.
 */
export async function readPostedState(
  pr: FindingsTargetPr,
  worktreePath: string,
): Promise<{ postedIds: Set<string>; pendingReviewId: number | null; problem: string | null }> {
  try {
    const [comments, reviews] = await Promise.all([
      runGh(apiArgs(pr, `/comments?per_page=${PER_PAGE}`), worktreePath),
      runGh(apiArgs(pr, `/reviews?per_page=${PER_PAGE}`), worktreePath),
    ]);

    const postedIds = extractPostedIds(comments);
    const pendingReviewId = parsePendingReviewId(reviews);

    if (pendingReviewId !== null) {
      const pending = await runGh(
        apiArgs(pr, `/reviews/${pendingReviewId}/comments?per_page=${PER_PAGE}`),
        worktreePath,
      );
      for (const id of extractPostedIds(pending)) postedIds.add(id);
    }

    return { postedIds, pendingReviewId, problem: null };
  } catch (err) {
    // Reported rather than swallowed: without this read every finding looks
    // unposted, and the UI has to say so before a human ticks a duplicate.
    return {
      postedIds: new Set(),
      pendingReviewId: null,
      problem: `Could not read which findings are already on the PR: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/** Post one review carrying the selected findings. */
export async function postReviewComments(input: {
  pr: FindingsTargetPr;
  worktreePath: string;
  findings: AnchoredReviewFinding[];
  comments: Record<string, string>;
  submit: boolean;
}): Promise<PostCommentsResult> {
  const { payload, results, hasContent } = buildReviewPayload({
    findings: input.findings,
    comments: input.comments,
    commitSha: input.pr.headSha,
    submit: input.submit,
  });

  if (!hasContent) {
    return { reviewUrl: null, pending: !input.submit, results };
  }

  const raw = await runGh(
    apiArgs(input.pr, "/reviews", ["--method", "POST", "--input", "-"]),
    input.worktreePath,
    JSON.stringify(payload),
  );

  let reviewUrl: string | null = null;
  try {
    const json = JSON.parse(raw) as { html_url?: unknown };
    if (typeof json.html_url === "string") reviewUrl = json.html_url;
  } catch {
    // The post succeeded — gh exited 0 — so an unparsable response costs the
    // link back to the review, not the result.
  }

  return { reviewUrl, pending: !input.submit, results };
}
