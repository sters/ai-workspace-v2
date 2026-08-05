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
    // macOS the usual sender is the kernel reclaiming memory.
    const hint =
      signalCode === "SIGKILL"
        ? " — likely the OS under memory pressure, or an external kill -9"
        : " — an external signal";
    return `${name} was killed by ${signalCode} (not requested by us)${hint}`;
  }

  if (exitCode !== null) return `${name} exited with code ${exitCode}`;

  return `${name} exited (no exit code or signal reported)`;
}
