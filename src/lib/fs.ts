/**
 * Filesystem helpers that `node:fs/promises` lacks.
 *
 * Server code reads the filesystem asynchronously (see "Never block the event
 * loop" in CLAUDE.md); these fill the gaps so a call site never reaches for the
 * sync form because the async one does not exist.
 */

import { access } from "node:fs/promises";

/** Whether anything — file, directory or other — exists at `p`. `Bun.file().exists()` is false for a directory. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Every path a `Bun.Glob` matches under `cwd`, without the blocking `scanSync`. */
export async function globScan(glob: Bun.Glob, cwd: string): Promise<string[]> {
  return Array.fromAsync(glob.scan({ cwd }));
}
