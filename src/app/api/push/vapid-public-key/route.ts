import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/web-push";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}
