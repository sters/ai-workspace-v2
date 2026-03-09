import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const GITHUB_REPO_URL =
  "https://github.com/sters/ai-workspace-v2.git";

export const UPDATE_FLAG_FILE = ".update-requested";

export function getUpdateFlagPath(): string {
  return resolve(
    process.env.AI_WORKSPACE_ROOT || process.cwd(),
    UPDATE_FLAG_FILE
  );
}

export function requestSelfUpdate(): void {
  writeFileSync(getUpdateFlagPath(), Date.now().toString());
}

export interface UpdateCheckResult {
  currentHash: string;
  latestHash: string | null;
  updateAvailable: boolean;
}

export async function checkForUpdate(
  currentHash: string
): Promise<UpdateCheckResult> {
  try {
    const proc = spawnSync("git", ["ls-remote", GITHUB_REPO_URL, "HEAD"], {
      timeout: 5000,
      encoding: "utf-8",
    });

    if (proc.status !== 0) {
      return { currentHash, latestHash: null, updateAvailable: false };
    }

    const latestHash = proc.stdout.trim().split("\t")[0] || null;
    const updateAvailable =
      !!latestHash && !latestHash.startsWith(currentHash);

    return { currentHash, latestHash, updateAvailable };
  } catch {
    return { currentHash, latestHash: null, updateAvailable: false };
  }
}
