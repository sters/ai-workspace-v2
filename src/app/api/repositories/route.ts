import { NextResponse } from "next/server";
import { listSelectableRepositories } from "@/lib/workspace/quick-create";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ repositories: listSelectableRepositories() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
