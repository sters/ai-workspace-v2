import { getVapidPublicKey } from "@/lib/web-push";

export function GET() {
  return Response.json({ publicKey: getVapidPublicKey() });
}
