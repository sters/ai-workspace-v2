let _cliPath: string | null = null;

function resolveCliPath(): string {
  const bin = Bun.which("claude");
  if (!bin) {
    console.warn("[cli-path] claude CLI not found in PATH");
    return "claude";
  }

  // Try realpath
  const realpathResult = Bun.spawnSync(["realpath", bin], { stdout: "pipe", stderr: "pipe" });
  if (realpathResult.success) {
    const resolved = realpathResult.stdout.toString().trim();
    if (resolved) return resolved;
  }

  // Try readlink -f
  const readlinkResult = Bun.spawnSync(["readlink", "-f", bin], { stdout: "pipe", stderr: "pipe" });
  if (readlinkResult.success) {
    const resolved = readlinkResult.stdout.toString().trim();
    if (resolved) return resolved;
  }

  return bin;
}

export function getCliPath(): string {
  if (_cliPath === null) _cliPath = resolveCliPath();
  return _cliPath;
}

/** Reset cached path (for testing). */
export function _resetCliPath(): void {
  _cliPath = null;
}
