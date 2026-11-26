import { listPrEvents } from "@/lib/db/pr-watch";

/** What the PR watcher recorded for this workspace, oldest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return Response.json({ events: listPrEvents(decodeURIComponent(name)) });
}
