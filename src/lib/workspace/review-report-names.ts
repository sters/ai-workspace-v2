/**
 * The `<org>_<repo>` stem every per-repository report in a review directory is
 * named with (`REVIEW-<stem>.md`, `VERIFY-README-<stem>.md`, `FINDINGS-<stem>.json`, …).
 *
 * Callers pass the repo they want rather than parsing the name back out of a
 * filename: both halves of the stem can contain underscores, so the split is
 * ambiguous in the one direction that matters.
 */
export function repoReportStem(repoPath: string, repoName: string): string {
  const orgName = repoPath.split("/").slice(0, -1).join("_") || "local";
  return `${orgName}_${repoName}`;
}

/** Whether a markdown report in a review directory belongs to this repository. */
export function isRepoReportFile(fileName: string, repoPath: string, repoName: string): boolean {
  return fileName.endsWith(`-${repoReportStem(repoPath, repoName)}.md`);
}
