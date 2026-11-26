import { readAllSettings, writeSettings } from "@/lib/claude/settings";
import { claudeSettingsWriteSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function GET() {
  try {
    const settings = await readAllSettings();
    return Response.json({ settings });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(claudeSettingsWriteSchema, body);
    if (!parsed.success) return parsed.response;
    const { scope, content } = parsed.data;

    try {
      await writeSettings(scope, content);
    } catch (err) {
      const msg = err instanceof SyntaxError ? "Content is not valid JSON" : String(err);
      const status = err instanceof SyntaxError ? 400 : 500;
      return Response.json({ error: msg }, { status });
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
