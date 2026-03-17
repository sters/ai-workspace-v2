/**
 * PR URL detection and branch resolution utilities.
 * Extracts GitHub PR URLs from text and resolves their branch info via `gh`.
 */

import { exec } from "@/lib/workspace/helpers";

export interface PrUrlInfo {
  url: string;
  owner: string;
  repo: string;
  repoPath: string; // github.com/owner/repo
  prNumber: number;
}

export interface PrBranchInfo {
  headBranch: string;
  baseBranch: string;
  repoPath: string;
  prUrl: string;
  isFork: boolean;
}

const PR_URL_RE = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;

/**
 * Extract GitHub PR URLs from text.
 * Returns deduplicated list of parsed PR URL info.
 */
export function extractPrUrls(text: string): PrUrlInfo[] {
  const seen = new Set<string>();
  const results: PrUrlInfo[] = [];

  for (const match of text.matchAll(PR_URL_RE)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({
      url,
      owner: match[1],
      repo: match[2],
      repoPath: `github.com/${match[1]}/${match[2]}`,
      prNumber: parseInt(match[3], 10),
    });
  }

  return results;
}

/**
 * Resolve PR branch info via `gh pr view`.
 * Requires `gh` CLI to be installed and authenticated.
 */
export function resolvePrBranch(prUrl: PrUrlInfo): PrBranchInfo {
  const output = exec(
    `gh pr view "${prUrl.url}" --json headRefName,baseRefName,headRepositoryOwner`,
  );
  const data = JSON.parse(output) as {
    headRefName: string;
    baseRefName: string;
    headRepositoryOwner: { login: string };
  };

  return {
    headBranch: data.headRefName,
    baseBranch: data.baseRefName,
    repoPath: prUrl.repoPath,
    prUrl: prUrl.url,
    isFork: data.headRepositoryOwner.login !== prUrl.owner,
  };
}
