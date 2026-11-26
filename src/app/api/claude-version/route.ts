import { getClaudeVersion } from "@/lib/claude/version";

export async function GET() {
  try {
    const version = await getClaudeVersion();
    return Response.json({ version });
  } catch (err) {
    return Response.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
