/**
 * Strip completed TODO items from a workspace's TODO files on disk.
 * Used by the autonomous pipeline to keep TODO files compact between cycles.
 */

import path from "node:path";
import { getWorkspaceDir } from "../config";
import { stripCompletedTodoItems } from "../parsers/todo";
import { listWorkspaceRepos } from "./git";

/**
 * For each repo in the workspace (optionally filtered by repo name), read its
 * `TODO-{repo}.md` file, remove completed (`[x]`) items and their child lines,
 * and write the file back if the content changed.
 *
 * Returns the list of modified TODO filenames.
 */
export async function stripCompletedTodosFromWorkspace(
  workspace: string,
  repoFilter?: string,
): Promise<string[]> {
  const workspacePath = path.join(getWorkspaceDir(), workspace);
  const allRepos = listWorkspaceRepos(workspace);
  const repos = repoFilter
    ? allRepos.filter((r) => r.repoName === repoFilter)
    : allRepos;

  const modified: string[] = [];
  for (const r of repos) {
    const todoFileName = `TODO-${r.repoName}.md`;
    const todoPath = path.join(workspacePath, todoFileName);
    const file = Bun.file(todoPath);
    if (!(await file.exists())) continue;
    const original = await file.text();
    const stripped = stripCompletedTodoItems(original);
    if (stripped !== original) {
      await Bun.write(todoPath, stripped);
      modified.push(todoFileName);
    }
  }
  return modified;
}
