import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CONFIG_FILE_PATH,
  _resetConfig,
} from "@/lib/app-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const exists = fs.existsSync(CONFIG_FILE_PATH);
    let content: string | null = null;
    if (exists) {
      content = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
    }
    return NextResponse.json({
      filePath: CONFIG_FILE_PATH,
      exists,
      content,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content } = body;

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 },
      );
    }

    // Validate YAML syntax
    if (content.trim()) {
      try {
        const parsed = parseYaml(content);
        if (parsed !== null && typeof parsed !== "object") {
          return NextResponse.json(
            { error: "Config must be a YAML mapping (object), not a scalar or array" },
            { status: 400 },
          );
        }
      } catch (err) {
        return NextResponse.json(
          { error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }
    }

    // Ensure parent directory exists
    const dir = path.dirname(CONFIG_FILE_PATH);
    fs.mkdirSync(dir, { recursive: true });

    // Write config file
    fs.writeFileSync(CONFIG_FILE_PATH, content, "utf-8");

    // Invalidate cached config so the app picks up changes immediately
    _resetConfig();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
