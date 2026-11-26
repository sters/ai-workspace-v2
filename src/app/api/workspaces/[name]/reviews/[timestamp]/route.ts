import { getReviewFileList } from "@/lib/workspace/reader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; timestamp: string }> }
) {
  try {
    const { name: rawName, timestamp: rawTimestamp } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return Response.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const timestamp = decodeURIComponent(rawTimestamp);
    if (timestamp.includes('..') || timestamp.includes('/') || timestamp.includes('\\')) {
      return Response.json({ error: "Invalid timestamp" }, { status: 400 });
    }
    const detail = await getReviewFileList(name, timestamp);
    if (!detail) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(detail);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
