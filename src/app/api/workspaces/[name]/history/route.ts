import { getHistory } from "@/lib/workspace/reader";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return Response.json({ error: "Invalid workspace name" }, { status: 400 });
    }
    const url = new URL(request.url);
    const skip = Math.max(0, parseInt(url.searchParams.get("skip") ?? "0", 10) || 0);
    const { entries, hasMore } = await getHistory(name, skip);
    return Response.json({ entries, hasMore });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
