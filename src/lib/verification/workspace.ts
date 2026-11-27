import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listPrSnapshots } from "@/lib/db/pr-watch";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { workspaceVariables } from "./model";
import type { Worktrees } from "./runner";

/** The workspace directory for a route's `name` param, or null when it is not a plain name. */
export function workspacePathFor(rawName: string): string | null {
  const name = decodeURIComponent(rawName);
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  return path.join(getWorkspaceDir(), name);
}

export async function worktreesFor(rawName: string): Promise<Worktrees> {
  const repos = await listWorkspaceRepos(decodeURIComponent(rawName));
  return Object.fromEntries(repos.map((r) => [r.repoName, r.worktreePath]));
}

/** The variables every step of a workspace's scenarios can use, PRs as the PR watcher last saw them. */
export function workspaceVariablesFor(rawName: string, worktrees: Worktrees): Record<string, string> {
  return workspaceVariables(worktrees, listPrSnapshots(decodeURIComponent(rawName)));
}
