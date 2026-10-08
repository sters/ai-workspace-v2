/**
 * Run a child process without blocking the event loop.
 *
 * The Next.js server, the chat server and the Slack bot are each one JavaScript
 * thread, so a `spawnSync` in any request path stops every other request, SSE
 * stream and timer in that process until the child exits. Server code spawns
 * through this instead.
 */

import { getCleanEnv } from "../env";

export interface ProcessResult {
  exitCode: number;
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Written to the child's stdin, which is closed afterwards. */
  stdin?: string;
  /** Kill the child after this long; it then resolves with a non-zero exit. */
  timeoutMs?: number;
}

/**
 * Throws only when the process cannot be started at all (a missing binary or
 * cwd); a non-zero exit is reported in the result.
 */
export async function runProcess(argv: string[], opts: RunProcessOptions = {}): Promise<ProcessResult> {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env ?? getCleanEnv(),
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = opts.timeoutMs === undefined ? undefined : setTimeout(() => proc.kill(), opts.timeoutMs);
  try {
    // Both pipes are drained concurrently: a child that fills one while the
    // other is being awaited would block forever.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, success: exitCode === 0, stdout, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
