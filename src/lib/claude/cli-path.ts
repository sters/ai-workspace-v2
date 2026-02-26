import { execSync } from "node:child_process";

let _cliPath: string | null = null;

function resolveCliPath(): string {
  try {
    const bin = execSync("which claude", { encoding: "utf-8" }).trim();
    try {
      return execSync(`realpath "${bin}"`, { encoding: "utf-8" }).trim();
    } catch {
      try {
        return execSync(`readlink -f "${bin}"`, { encoding: "utf-8" }).trim();
      } catch {
        return bin;
      }
    }
  } catch {
    console.warn("[cli-path] claude CLI not found in PATH");
    return "claude";
  }
}

export function getCliPath(): string {
  if (_cliPath === null) _cliPath = resolveCliPath();
  return _cliPath;
}

/** Reset cached path (for testing). */
export function _resetCliPath(): void {
  _cliPath = null;
}
