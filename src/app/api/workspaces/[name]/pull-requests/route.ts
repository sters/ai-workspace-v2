import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { getCachedRepoPullRequest, PR_CACHE_TTL_MS } from "@/lib/workspace/pr-cache";
import { readPrValidations } from "@/lib/workspace/pr-validations";

/**
 * Without `?repo=`, the repositories and the recorded validations — local and
 * cheap, read off disk every time so a just-finished validate operation shows
 * up immediately. With `?repo=<repoPath>`, that repository's PR: TTL-cached
 * because it costs two `gh` round trips, and `?refresh=1` is the tab's Refresh
 * button asking past the cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return Response.json({ error: "Invalid workspace name" }, { status: 400 });
    }

    const searchParams = new URL(request.url).searchParams;
    const repoPath = searchParams.get("repo");
    const repos = await listWorkspaceRepos(name);

    if (repoPath === null) {
      const store = await readPrValidations(path.join(getWorkspaceDir(), name));
      return Response.json({
        repos: repos.map(({ repoName, repoPath }) => ({ repoName, repoPath })),
        validations: store.validations,
      });
    }

    const repo = repos.find((r) => r.repoPath === repoPath);
    if (!repo) {
      return Response.json({ error: `Repository not in workspace: ${repoPath}` }, { status: 404 });
    }
    const read = await getCachedRepoPullRequest(name, repo, {
      force: searchParams.get("refresh") !== null,
    });
    return Response.json({ ...read, cacheTtlMs: PR_CACHE_TTL_MS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
