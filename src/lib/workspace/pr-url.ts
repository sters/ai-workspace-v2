/**
 * PR URL detection and branch resolution utilities.
 * Extracts GitHub PR URLs from text and resolves their branch info via `gh`.
 */

import { exec } from "@/lib/workspace/helpers";
import type { PrUrlInfo } from "@/lib/github-pr-url";

export { extractPrUrls, parsePrUrl } from "@/lib/github-pr-url";
export type { PrUrlInfo } from "@/lib/github-pr-url";

export interface PrBranchInfo {
  headBranch: string;
  baseBranch: string;
  repoPath: string;
  prUrl: string;
  isFork: boolean;
  title: string;
  body: string;
}

/**
 * Resolve PR branch info via `gh pr view`.
 * Requires `gh` CLI to be installed and authenticated.
 */
export async function resolvePrBranch(prUrl: PrUrlInfo): Promise<PrBranchInfo> {
  const output = await exec(
    `gh pr view "${prUrl.url}" --json headRefName,baseRefName,headRepositoryOwner,title,body`,
  );
  const data = JSON.parse(output) as {
    headRefName: string;
    baseRefName: string;
    headRepositoryOwner: { login: string };
    title?: string;
    body?: string;
  };

  return {
    headBranch: data.headRefName,
    baseBranch: data.baseRefName,
    repoPath: prUrl.repoPath,
    prUrl: prUrl.url,
    isFork: data.headRepositoryOwner.login !== prUrl.owner,
    title: data.title ?? "",
    body: data.body ?? "",
  };
}
