import { getReviewSessions } from "@/lib/workspace/reader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return Response.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const reviews = await getReviewSessions(name);
    return Response.json(reviews);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
