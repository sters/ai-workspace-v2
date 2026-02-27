import { NextRequest, NextResponse } from "next/server";
import { readAllSettings, writeSettings, isValidScope } from "@/lib/claude/settings";
import type { SettingsScope } from "@/lib/claude/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await readAllSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, content } = body as { scope: string; content: string };

    if (!isValidScope(scope)) {
      return NextResponse.json(
        { error: "Invalid scope. Must be one of: project, local, user" },
        { status: 400 }
      );
    }

    try {
      await writeSettings(scope as SettingsScope, content);
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
