import { runClaudeCommand } from "@/lib/claude/cli";
import { mcpRemoveSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(mcpRemoveSchema, body);
  if (!parsed.success) return parsed.response;
  const { name, scope } = parsed.data;

  const args = ["mcp", "remove"];
  if (scope) {
    args.push("--scope", scope);
  }
  args.push(name);

  const result = await runClaudeCommand({ args });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (!result.success) {
    return Response.json(
      { error: stderr || "claude mcp remove failed", stdout },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, output: stdout || stderr });
}
