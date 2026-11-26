import { readMcpServers } from "@/lib/claude/mcp";

export async function GET() {
  try {
    const servers = await readMcpServers();
    return Response.json({ servers });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
