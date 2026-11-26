import { getReadme } from "@/lib/workspace/reader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return Response.json({ error: "Invalid workspace name" }, { status: 400 });
  }
  const readme = await getReadme(name);
  if (readme === null) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(readme, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
