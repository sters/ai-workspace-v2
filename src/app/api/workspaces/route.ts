import { NextResponse } from "next/server";
import { listWorkspaces } from "@/lib/workspace/reader";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspaces = await listWorkspaces();
  return NextResponse.json(workspaces);
}
