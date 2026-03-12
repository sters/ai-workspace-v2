import { NextRequest, NextResponse } from "next/server";
import { readAllSettings, writeSettings } from "@/lib/claude/settings";
import { claudeSettingsWriteSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await readAllSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseBody(claudeSettingsWriteSchema, body);
    if (!parsed.success) return parsed.response;
    const { scope, content } = parsed.data;

    try {
      await writeSettings(scope, content);
    } catch (err) {
      const msg = err instanceof SyntaxError ? "Content is not valid JSON" : String(err);
      const status = err instanceof SyntaxError ? 400 : 500;
      return NextResponse.json({ error: msg }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
