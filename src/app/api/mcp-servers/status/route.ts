import { getMcpStatuses } from "@/lib/claude/mcp";

export async function GET() {
  try {
    const statuses = await getMcpStatuses();
    return Response.json({ statuses });
  } catch (err) {
    return Response.json(
      { statuses: [], error: String(err) },
      { status: 500 }
    );
  }
}
