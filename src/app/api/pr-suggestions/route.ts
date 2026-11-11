import { NextResponse } from "next/server";
import { getWorkspacePrSuggestions, listUnarchivedWorkspaceNames } from "@/lib/pr-watcher";
import { hasSuggestions } from "@/lib/pr-watcher/suggestions";

export const dynamic = "force-dynamic";

/** Unarchived workspaces with something proposed on their PRs, for the dashboard. */
export async function GET() {
  const workspaces: string[] = [];
  for (const name of await listUnarchivedWorkspaceNames()) {
    if (hasSuggestions(await getWorkspacePrSuggestions(name))) workspaces.push(name);
  }
  return NextResponse.json({ workspaces });
}
