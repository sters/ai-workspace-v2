import { listSelectableRepositories } from "@/lib/workspace/quick-create";

export async function GET() {
  try {
    return Response.json({ repositories: await listSelectableRepositories() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
