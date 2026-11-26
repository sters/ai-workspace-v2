import { resolveOperationPage } from "@/lib/operation-page";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await resolveOperationPage(id);
  if (!page) return Response.json({ error: "Operation not found" }, { status: 404 });
  return Response.json(page);
}
