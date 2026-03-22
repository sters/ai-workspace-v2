import { NextResponse } from "next/server";
import { addSubscription } from "@/lib/web-push";
import { pushSubscriptionSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(pushSubscriptionSchema, body);
  if (!parsed.success) return parsed.response;

  addSubscription(parsed.data);
  return NextResponse.json({ ok: true });
}
