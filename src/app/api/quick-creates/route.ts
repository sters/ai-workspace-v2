import { NextResponse } from "next/server";
import { listQuickCreates } from "@/lib/workspace/quick-create-progress";

export const dynamic = "force-dynamic";

/** The web form's quick creates that are running or finished a little while ago. */
export async function GET() {
  return NextResponse.json(listQuickCreates());
}
