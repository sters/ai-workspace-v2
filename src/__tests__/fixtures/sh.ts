/**
 * Synchronous shell for building git fixtures. Test setup is sequential and
 * runs outside any server, so blocking here costs nothing — server code spawns
 * through `@/lib/process/run` instead.
 */
export function sh(cmd: string, opts?: { cwd?: string }): string {
  const result = Bun.spawnSync(["sh", "-c", cmd], { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    throw new Error(result.stderr.toString().trim() || `Command failed: ${cmd}`);
  }
  return result.stdout.toString().trim();
}
