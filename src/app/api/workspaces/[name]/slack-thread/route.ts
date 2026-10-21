import { NextResponse } from "next/server";
import { findWorkspaceSlackThread } from "@/lib/chat-server/slack-thread";

export const dynamic = "force-dynamic";

/** The Slack thread working in this workspace, for the chat page to offer continuing its conversation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  return NextResponse.json({ slackThread: findWorkspaceSlackThread(name, Date.now()) });
}
