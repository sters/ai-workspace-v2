import { runProcess } from "./process/run";

export const GITHUB_REPO_URL =
  "https://github.com/sters/ai-workspace-v2.git";

export interface UpdateCheckResult {
  currentHash: string;
  latestHash: string | null;
  updateAvailable: boolean;
}

export async function checkForUpdate(
  currentHash: string
): Promise<UpdateCheckResult> {
  try {
    const proc = await runProcess(["git", "ls-remote", GITHUB_REPO_URL, "HEAD"], {
      env: process.env,
      timeoutMs: 5000,
    });

    if (!proc.success) {
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
