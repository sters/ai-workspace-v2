import { listQuickCreates } from "@/lib/workspace/quick-create-progress";

/** The web form's quick creates that are running or finished a little while ago. */
export async function GET() {
  return Response.json(listQuickCreates());
}
