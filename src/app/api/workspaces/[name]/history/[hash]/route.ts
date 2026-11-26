import { getCommitDiff } from "@/lib/workspace/reader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; hash: string }> }
) {
  const { name: rawName, hash } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const diff = await getCommitDiff(name, hash);
  if (diff === null) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ diff });
}
