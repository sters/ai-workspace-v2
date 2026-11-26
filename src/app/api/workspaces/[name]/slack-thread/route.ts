import { findWorkspaceSlackThread } from "@/lib/chat-server/slack-thread";

/** The Slack thread working in this workspace, for the chat page to offer continuing its conversation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  return Response.json({ slackThread: findWorkspaceSlackThread(name, Date.now()) });
}
