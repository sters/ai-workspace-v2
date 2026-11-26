import { getWorkspaceSummary } from "@/lib/workspace/reader";

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
    const summary = await getWorkspaceSummary(name);
    if (!summary) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(summary);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
