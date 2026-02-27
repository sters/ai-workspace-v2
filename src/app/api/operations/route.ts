import { NextResponse } from "next/server";
import { getOperations } from "@/lib/pipeline-manager";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getOperations());
}
