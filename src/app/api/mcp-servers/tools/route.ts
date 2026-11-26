import { getMcpTools } from "@/lib/claude/mcp";

export async function GET() {
  try {
    const tools = await getMcpTools();
    return Response.json({ tools });
  } catch (err) {
    return Response.json(
      { tools: [], error: String(err) },
      { status: 500 }
    );
  }
}
