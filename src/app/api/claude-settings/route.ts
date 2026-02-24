import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AI_WORKSPACE_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

const VALID_SCOPES = ["project", "local", "user"] as const;
type Scope = (typeof VALID_SCOPES)[number];

function getFilePath(scope: Scope): string {
  switch (scope) {
    case "project":
      return path.join(AI_WORKSPACE_ROOT, ".claude", "settings.json");
    case "local":
      return path.join(AI_WORKSPACE_ROOT, ".claude", "settings.local.json");
    case "user":
      return path.join(os.homedir(), ".claude", "settings.json");
  }
}

async function readSettingsFile(scope: Scope) {
  const filePath = getFilePath(scope);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      JSON.parse(raw);
    } catch {
      return { scope, filePath, exists: true, content: raw, error: "Invalid JSON" };
    }
    return { scope, filePath, exists: true, content: raw, error: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { scope, filePath, exists: false, content: null, error: null };
    }
    return { scope, filePath, exists: false, content: null, error: String(err) };
  }
}

export async function GET() {
  const settings = await Promise.all(
    VALID_SCOPES.map((scope) => readSettingsFile(scope))
  );
  return NextResponse.json({ settings });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, content } = body as { scope: string; content: string };

    if (!VALID_SCOPES.includes(scope as Scope)) {
      return NextResponse.json(
        { error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(", ")}` },
        { status: 400 }
      );
    }

    try {
      JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "Content is not valid JSON" },
        { status: 400 }
      );
    }

    const filePath = getFilePath(scope as Scope);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
