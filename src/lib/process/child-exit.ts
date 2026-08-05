/**
 * Human-readable exit reasons for the long-lived child processes that
 * `bin/start.ts` supervises.
 *
 * The whole tree is tied to next-server's lifetime, so when one process dies
 * the others are torn down by design. Without a named reason on the way out,
 * the only visible line is whichever child happens to log its own shutdown,
 * which reads as if that child were the cause.
 */

export interface ChildExitInfo {
  name: string;
  exitCode: number | null;
  /** Bun reports `signalCode` and leaves `exitCode` null when a signal killed the process. */
  signalCode: string | null;
  /** True when this supervisor asked the child to stop. */
  requested?: boolean;
}

export function describeChildExit({
  name,
  exitCode,
  signalCode,
  requested = false,
}: ChildExitInfo): string {
  if (signalCode) {
    if (requested) return `${name} was killed by ${signalCode} (shutdown requested by us)`;

    // SIGKILL cannot be handled, so the process left no output of its own. On
    // macOS the usual sender is the kernel reclaiming memory. An unrequested
    // SIGTERM is nearly always name-based: `pkill -f "next dev"` matches our
    // Next.js child whatever port or project it belongs to.
    const hint =
      signalCode === "SIGKILL"
        ? " — likely the OS under memory pressure, or an external kill -9"
        : signalCode === "SIGTERM"
          ? " — an external signal, e.g. a broad `pkill -f` matching our command line"
          : " — an external signal";
    return `${name} was killed by ${signalCode} (not requested by us)${hint}`;
  }

  if (exitCode !== null) return `${name} exited with code ${exitCode}`;

  return `${name} exited (no exit code or signal reported)`;
}

/** Signal numbers for the `128 + n` exit convention. Extend as handlers appear. */
const SIGNAL_NUMBERS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/**
 * Exit code to use when we were stopped by a signal we could not re-raise.
 * An unknown signal still yields a non-zero code, since the whole point is to
 * not report a clean `0` for a death we did not choose.
 */
export function signalExitCode(signal: string): number {
  return 128 + (SIGNAL_NUMBERS[signal] ?? 0);
}

export interface ReraiseSignalDeps {
  pid: number;
  removeAllListeners: (event: string) => void;
  kill: (pid: number, signal: string) => void;
}

/**
 * Die from the signal that stopped us, so our own supervisor reads a
 * `signalCode` rather than the exit code a graceful handler would report.
 *
 * A wrapper that catches SIGTERM, stops its child and then exits 0 launders an
 * external kill into a voluntary shutdown: the parent sees `exited with code 0`
 * and cannot name what actually happened. Returns false if the signal could not
 * be delivered, so the caller can fall back to `signalExitCode()`.
 */
export function reraiseSignal(
  signal: string,
  deps: ReraiseSignalDeps = {
    pid: process.pid,
    removeAllListeners: (event) => void process.removeAllListeners(event),
    kill: (pid, sig) => void process.kill(pid, sig as NodeJS.Signals),
  },
): boolean {
  try {
    // Without this our own handler catches the signal again and nothing dies.
    deps.removeAllListeners(signal);
    deps.kill(deps.pid, signal);
    return true;
  } catch {
    return false;
  }
}
