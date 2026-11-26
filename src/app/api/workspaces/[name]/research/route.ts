import { getResearchReport } from "@/lib/workspace/reader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const report = await getResearchReport(name);
  if (report === null) {
    return Response.json({ summary: "", files: [] });
  }
  return Response.json(report);
}
