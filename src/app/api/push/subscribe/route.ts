import { NextResponse } from "next/server";
import { z } from "zod";
import { addSubscription } from "@/lib/web-push";

export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = subscriptionSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  addSubscription(result.data);
  return NextResponse.json({ ok: true });
}
