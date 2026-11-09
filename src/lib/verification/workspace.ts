import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace/git";
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
