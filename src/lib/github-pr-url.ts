/**
 * GitHub PR URL parsing, with no node imports so the quick-create form can
 * classify what was typed with the same rule the server applies.
 */

export interface PrUrlInfo {
  url: string;
  owner: string;
  repo: string;
  repoPath: string; // github.com/owner/repo
  prNumber: number;
}

const PR_URL_RE = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g;

/** Anchored: the whole entry is a PR, optionally with a sub-page, query or fragment. */
const PR_ENTRY_RE = /^(?:https:\/\/)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;

function toInfo(owner: string, repo: string, prNumber: string): PrUrlInfo {
  return {
    url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    owner,
    repo,
    repoPath: `github.com/${owner}/${repo}`,
    prNumber: parseInt(prNumber, 10),
  };
}

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
    results.push(toInfo(match[1], match[2], match[3]));
  }

  return results;
}

/**
 * One repository entry read as a PR, or `null` when it is a plain repository
 * path. Unlike `extractPrUrls` this does not search: a PR mentioned inside
 * other text is not an entry.
 */
export function parsePrUrl(entry: string): PrUrlInfo | null {
  const match = entry.trim().match(PR_ENTRY_RE);
  return match ? toInfo(match[1], match[2], match[3]) : null;
}
