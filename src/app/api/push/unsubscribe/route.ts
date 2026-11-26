import { removeSubscription } from "@/lib/web-push";
import { pushUnsubscribeSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(pushUnsubscribeSchema, body);
  if (!parsed.success) return parsed.response;

  removeSubscription(parsed.data.endpoint);
  return Response.json({ ok: true });
}
