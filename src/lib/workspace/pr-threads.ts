/**
 * Reads the PR on each workspace worktree's branch, together with its unresolved
 * review threads, for the workspace's Pull Requests tab.
 *
 * Everything here joins on the GraphQL **thread node id** rather than the
 * comment's numeric id, because that is the id the rest of the pipeline already
 * speaks: `## PR Review Threads` rows carry it, and `create-pr` replies to and
 * resolves threads by it after a push. Reading comments through the REST
 * endpoint would be one call fewer but yields neither the node id nor
 * `isResolved`, so a resolved thread could not be told from a live one.
 *
 * The `gh` calls are split into pure parsers and a thin spawn layer so the JSON
 * shapes are testable without a network or a GitHub account.
 */

import { execArgs } from "./helpers";
import { listWorkspaceRepos } from "./git";
import type {
  PrCheck,
  PrCheckState,
  PrChecksSummary,
  PrReviewThread,
  PullRequestProblem,
  WorkspacePullRequest,
} from "@/types/pull-request";

/** Comments per thread. A thread longer than this is a discussion, not an ask. */
const MAX_COMMENTS_PER_THREAD = 20;
const MAX_THREADS = 100;

/** Checks on the head commit. Well past what any repo runs on one PR. */
const MAX_CHECKS = 100;

/**
 * Threads and CI in one query.
 *
 * The CI half could equally be `gh pr checks`, but that is another process spawn
 * and another network round trip per repository for data GitHub already returns
 * alongside the threads. `statusCheckRollup` on the last commit is the same thing
 * the PR page shows.
 */
export const REVIEW_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:${MAX_THREADS}){
        nodes{
          id
          isResolved
          isOutdated
          path
          line
          comments(first:${MAX_COMMENTS_PER_THREAD}){
            nodes{ url author{login} body createdAt }
          }
        }
      }
      commits(last:1){
        nodes{
          commit{
            statusCheckRollup{
              state
              contexts(first:${MAX_CHECKS}){
                nodes{
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const PR_VIEW_FIELDS =
  "number,url,title,state,isDraft,headRefName,headRefOid,baseRefName,author,updatedAt";

export interface PrLocator {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

/**
 * Split a PR URL into the coordinates the thread query needs.
 *
 * The host matters: `gh api` targets the default host unless told otherwise, so
 * a PR on an enterprise instance needs its host passed explicitly or the query
 * silently asks github.com about a repository that isn't there.
 */
export function parsePrLocator(url: string): PrLocator | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim());
  if (!match) return null;
  return { host: match[1], owner: match[2], repo: match[3], number: Number(match[4]) };
}

function login(author: unknown): string {
  const name = (author as { login?: unknown } | null)?.login;
  return typeof name === "string" && name !== "" ? name : "(unknown)";
}

export function parsePrView(
  raw: string,
  repo: { repoName: string; repoPath: string; worktreePath: string },
): WorkspacePullRequest | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const locator = parsePrLocator(typeof json.url === "string" ? json.url : "");
  if (!locator) return null;

  return {
    repoName: repo.repoName,
    repoPath: repo.repoPath,
    worktreePath: repo.worktreePath,
    host: locator.host,
    owner: locator.owner,
    repo: locator.repo,
    number: typeof json.number === "number" ? json.number : locator.number,
    url: json.url as string,
    title: typeof json.title === "string" ? json.title : "(untitled)",
    state: typeof json.state === "string" ? json.state : "OPEN",
    isDraft: json.isDraft === true,
    headRefName: typeof json.headRefName === "string" ? json.headRefName : "",
    headSha: typeof json.headRefOid === "string" ? json.headRefOid : "",
    baseRefName: typeof json.baseRefName === "string" ? json.baseRefName : "",
    author: login(json.author),
    updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : "",
    threads: [],
    checks: emptyChecks(),
  };
}

export function parseReviewThreads(raw: string): PrReviewThread[] {
  let nodes: unknown;
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    nodes = (json as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown } } } } })
      .data?.repository?.pullRequest?.reviewThreads?.nodes;
  } catch {
    return [];
  }
  if (!Array.isArray(nodes)) return [];

  const threads: PrReviewThread[] = [];
  for (const node of nodes) {
    const n = node as Record<string, unknown>;
    // No node id means nothing downstream can join on it: no validation could be
    // stored against it and no reply could ever be posted to it.
    if (typeof n.id !== "string" || n.id === "") continue;

    const commentNodes = (n.comments as { nodes?: unknown } | undefined)?.nodes;
    threads.push({
      id: n.id,
      isResolved: n.isResolved === true,
      isOutdated: n.isOutdated === true,
      path: typeof n.path === "string" ? n.path : null,
      line: typeof n.line === "number" ? n.line : null,
      comments: (Array.isArray(commentNodes) ? commentNodes : []).map((c) => {
        const comment = c as Record<string, unknown>;
        return {
          url: typeof comment.url === "string" ? comment.url : "",
          author: login(comment.author),
          body: typeof comment.body === "string" ? comment.body : "",
          createdAt: typeof comment.createdAt === "string" ? comment.createdAt : "",
        };
      }),
    });
  }
  return threads;
}

/**
 * A CheckRun is only judged by its conclusion once it has finished; before that
 * its `status` says whether it has started.
 *
 * `IN_PROGRESS` alone is `running`. Everything else short of `COMPLETED` —
 * including a status GitHub adds later — is `queued`, which is deliberate: the
 * one property that must survive an unrecognized value is that the run is **not
 * finished**, since calling it `unknown` would let a summary report that
 * everything passed while a job is still outstanding.
 */
function checkRunState(status: string, conclusion: string): PrCheckState {
  if (status !== "COMPLETED") return status === "IN_PROGRESS" ? "running" : "queued";
  switch (conclusion) {
    case "SUCCESS":
      return "success";
    // All four mean "did not pass, and will not pass on its own" — which is the
    // distinction a reader is making about a finished run.
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    // NEUTRAL and STALE say nothing about pass or fail, so they get their own
    // bucket rather than being guessed into one.
    default:
      return "unknown";
  }
}

/**
 * A legacy commit status has one field and its own enum. `PENDING` is what CI
 * posts when it picks the work up, so it is running; `EXPECTED` means the status
 * has not been posted at all, which is the queued case.
 */
function statusContextState(state: string): PrCheckState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
      return "running";
    case "EXPECTED":
      return "queued";
    default:
      return "unknown";
  }
}

/** Failures first, then what is still in flight, then finished non-passes. */
const STATE_ORDER: Record<PrCheckState, number> = {
  failure: 0,
  running: 1,
  queued: 2,
  unknown: 3,
  cancelled: 4,
  skipped: 5,
  success: 6,
};

/** Zero for every state, so no reader has to handle a missing key. */
function zeroCounts(): Record<PrCheckState, number> {
  return {
    success: 0,
    failure: 0,
    running: 0,
    queued: 0,
    skipped: 0,
    cancelled: 0,
    unknown: 0,
  };
}

function emptyChecks(): PrChecksSummary {
  return { checks: [], counts: zeroCounts(), reported: false };
}

export function parseStatusChecks(raw: string): PrChecksSummary {
  let rollup: unknown;
  try {
    const json = JSON.parse(raw) as {
      data?: {
        repository?: {
          pullRequest?: {
            commits?: { nodes?: { commit?: { statusCheckRollup?: unknown } }[] };
          };
        };
      };
    };
    rollup = json.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  } catch {
    return emptyChecks();
  }

  // An absent rollup means no CI is configured on this PR. Reporting that as
  // passing would claim something GitHub never said, so `reported` stays false.
  if (typeof rollup !== "object" || rollup === null) return emptyChecks();

  const nodes = (rollup as { contexts?: { nodes?: unknown } }).contexts?.nodes;
  if (!Array.isArray(nodes)) return emptyChecks();

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const url = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;

  const checks: PrCheck[] = nodes.map((node) => {
    const n = node as Record<string, unknown>;
    // Two vocabularies: the modern CheckRun carries status + conclusion, while a
    // legacy commit status carries a single state.
    const isStatusContext = n.__typename === "StatusContext" || "context" in n;
    return isStatusContext
      ? {
          name: str(n.context) || "(unnamed check)",
          state: statusContextState(str(n.state)),
          url: url(n.targetUrl),
        }
      : {
          name: str(n.name) || "(unnamed check)",
          state: checkRunState(str(n.status), str(n.conclusion)),
          url: url(n.detailsUrl),
        };
  });

  checks.sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name),
  );

  const counts = zeroCounts();
  for (const check of checks) counts[check.state] += 1;

  return { checks, counts, reported: true };
}

function fetchThreadsAndChecks(pr: WorkspacePullRequest): {
  threads: PrReviewThread[];
  checks: PrChecksSummary;
} {
  const args = [
    "gh", "api", "graphql",
    "--hostname", pr.host,
    "-f", `query=${REVIEW_THREADS_QUERY}`,
    "-F", `owner=${pr.owner}`,
    "-F", `name=${pr.repo}`,
    "-F", `number=${pr.number}`,
  ];
  const raw = execArgs(args, { cwd: pr.worktreePath });
  return { threads: parseReviewThreads(raw), checks: parseStatusChecks(raw) };
}

/**
 * The PR for each repo's current branch, with its review threads.
 *
 * Repos are read concurrently: each one costs two network round trips, and they
 * are independent. A repo that yields nothing lands in `problems` rather than
 * being dropped, so the tab can distinguish "no PR opened yet" from "`gh`
 * failed" — the second is actionable and the first is normal.
 */
export async function listWorkspacePullRequests(workspaceName: string): Promise<{
  pullRequests: WorkspacePullRequest[];
  problems: PullRequestProblem[];
}> {
  const repos = listWorkspaceRepos(workspaceName);

  const results = await Promise.all(
    repos.map(async (repo) => {
      let pr: WorkspacePullRequest | null;
      try {
        const raw = execArgs(
          ["gh", "pr", "view", "--json", PR_VIEW_FIELDS],
          { cwd: repo.worktreePath },
        );
        pr = parsePrView(raw, repo);
      } catch (err) {
        // `gh pr view` exits non-zero both when no PR exists for the branch and
        // when the call itself failed; its stderr is the only thing that
        // distinguishes them, so it is surfaced verbatim.
        return {
          problem: { repoName: repo.repoName, reason: String(err instanceof Error ? err.message : err) },
        };
      }

      if (!pr) {
        return { problem: { repoName: repo.repoName, reason: "Could not read PR details from gh" } };
      }

      try {
        const { threads, checks } = fetchThreadsAndChecks(pr);
        pr.threads = threads;
        pr.checks = checks;
      } catch (err) {
        // The PR itself is worth showing without its threads; say why they are
        // missing. `checks` stays `reported: false`, which the tab renders as
        // "unknown" rather than as a green PR.
        return {
          pr,
          problem: {
            repoName: repo.repoName,
            reason: `PR #${pr.number} found, but review threads and CI could not be read: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        };
      }

      return { pr };
    }),
  );

  return {
    pullRequests: results.flatMap((r) => (r.pr ? [r.pr] : [])),
    problems: results.flatMap((r) => (r.problem ? [r.problem] : [])),
  };
}
