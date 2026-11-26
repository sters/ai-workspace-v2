import { getWorkspacePrSuggestions, listUnarchivedWorkspaceNames } from "@/lib/pr-watcher";
import { hasSuggestions } from "@/lib/pr-watcher/suggestions";

/** Unarchived workspaces with something proposed on their PRs, for the dashboard. */
export async function GET() {
  const workspaces: string[] = [];
  for (const name of await listUnarchivedWorkspaceNames()) {
    if (hasSuggestions(await getWorkspacePrSuggestions(name))) workspaces.push(name);
  }
  return Response.json({ workspaces });
}
