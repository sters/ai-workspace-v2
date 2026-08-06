/**
 * The failing job's log, fetched on demand for the Pull Requests tab's triage of
 * a CI failure.
 *
 * This is read **at click time and inlined into the triage instruction**, not
 * left for the run to fetch, because neither agent downstream can go get it: the
 * TODO updater's `allowedTools` grant `Bash(git:*)` and nothing else, and the
 * executor's prompt forbids `gh run view` outright, working instead from "the
 * failing job name and its key error line" the item is required to quote. So the
 * log has to be in the instruction or the item cannot name a cause.
 *
 * Deliberately kept out of the tab's own read (`pr-threads.ts`): a log costs a
 * `gh` round trip per failing check and nobody reads it until they decide to act,
 * whereas that read runs on every mount and focus.
 */

import { getCleanEnv } from "@/lib/env";
import { listWorkspaceRepos } from "./git";
import type { PrCheckFailureLog } from "@/types/pull-request";

/**
 * Lines kept, counted from the end.
 *
 * The tail, because a runner prints the failure it stopped on last — a head
 * slice of a test run is setup output. `--log-failed` already narrows to the
 * failing steps, so this is a second bound against one pathological step.
 */
export const MAX_LOG_LINES = 150;
export const MAX_LOG_CHARS = 10_000;

const FETCH_TIMEOUT_MS = 60_000;

export interface CheckRunRef {
  /** A job's log is the failing step's; a run's is every failing job in it. */
  kind: "job" | "run";
  id: string;
}

/**
 * Locate the Actions job (or failing that, the run) behind a check's details url.
 *
 * Host-agnostic on purpose — an enterprise instance uses the same path shape —
 * and returns null for anything that is not GitHub Actions, since an external
 * CI's `targetUrl` points at that CI and `gh` has no log to fetch there.
 */
export function parseCheckRunRef(url: string | null | undefined): CheckRunRef | null {
  if (!url) return null;
  const job = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url);
  if (job) return { kind: "job", id: job[1] };
  const run = /\/actions\/runs\/(\d+)/.exec(url);
  if (run) return { kind: "run", id: run[1] };
  return null;
}

/**
 * `gh run view --log*` prefixes every line with `<job>\t<step>\t<timestamp> `,
 * which is three quarters of the tokens and none of the error.
 */
function stripLinePrefix(line: string): string {
  const columns = line.split("\t");
  const body = columns.length >= 3 ? columns.slice(2).join("\t") : line;
  return body.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, "");
}

export function excerptFailureLog(raw: string): { text: string; truncated: boolean } {
  const lines = raw
    .split("\n")
    .map(stripLinePrefix)
    .map((line) => line.trimEnd())
    // `##[group]` markers are the runner's folding, not output.
    .filter((line) => line.trim() !== "" && !/^##\[(group|endgroup|section)/.test(line));

  let truncated = lines.length > MAX_LOG_LINES;
  let text = lines.slice(-MAX_LOG_LINES).join("\n");

  if (text.length > MAX_LOG_CHARS) {
    text = text.slice(-MAX_LOG_CHARS);
    truncated = true;
  }

  return { text, truncated };
}

async function runGh(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe", env: getCleanEnv() });
  const timer = setTimeout(() => proc.kill(), FETCH_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    // A non-zero exit with output still carries the log: `gh run view` reports the
    // job's own failure in its exit code on some versions.
    if (exitCode !== 0 && stdout.trim() === "") {
      throw new Error(stderr.trim() || `gh exited ${exitCode}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

/** One check's log, or the reason there isn't one. */
async function fetchOne(
  check: { repoName: string; name: string; url?: string | null },
  worktreePath: string | undefined,
): Promise<PrCheckFailureLog> {
  const base: PrCheckFailureLog = {
    repoName: check.repoName,
    name: check.name,
    url: check.url ?? null,
    excerpt: null,
    truncated: false,
  };

  if (!worktreePath) {
    return { ...base, reason: `No worktree for ${check.repoName} in this workspace` };
  }

  const ref = parseCheckRunRef(check.url);
  if (!ref) {
    return {
      ...base,
      reason: check.url
        ? "Not a GitHub Actions check — its log lives on the external CI"
        : "GitHub reported no details url for this check",
    };
  }

  const target = ref.kind === "job" ? ["--job", ref.id] : [ref.id];
  try {
    // `--log-failed` is the failing steps only. It comes back empty when the job
    // died before a step produced output, which is what the full log is for.
    let raw = await runGh(["gh", "run", "view", ...target, "--log-failed"], worktreePath);
    if (raw.trim() === "") {
      raw = await runGh(["gh", "run", "view", ...target, "--log"], worktreePath);
    }
    const { text, truncated } = excerptFailureLog(raw);
    if (text === "") return { ...base, reason: "GitHub returned an empty log for this job" };
    return { ...base, excerpt: text, truncated };
  } catch (err) {
    return { ...base, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Logs for the selected failing checks, one per check.
 *
 * A failure to read one is returned as a `reason` rather than thrown: the triage
 * is still worth starting, and an item that says the log could not be read and
 * must be reproduced locally is more use than no run at all.
 */
export async function fetchPrCheckFailureLogs(input: {
  workspace: string;
  checks: { repoName: string; name: string; url?: string | null }[];
}): Promise<PrCheckFailureLog[]> {
  const worktrees = new Map(
    listWorkspaceRepos(input.workspace).map((r) => [r.repoName, r.worktreePath]),
  );
  return Promise.all(input.checks.map((check) => fetchOne(check, worktrees.get(check.repoName))));
}
