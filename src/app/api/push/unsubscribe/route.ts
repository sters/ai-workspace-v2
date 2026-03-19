import { NextResponse } from "next/server";
import { z } from "zod";
import { removeSubscription } from "@/lib/web-push";

export const dynamic = "force-dynamic";

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = unsubscribeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  removeSubscription(result.data.endpoint);
  return NextResponse.json({ ok: true });
}
