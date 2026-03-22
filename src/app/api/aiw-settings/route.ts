import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  getConfigFilePath,
  _resetConfig,
} from "@/lib/config";
import { aiwSettingsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filePath = getConfigFilePath();
    const exists = fs.existsSync(filePath);
    let content: string | null = null;
    if (exists) {
      content = fs.readFileSync(filePath, "utf-8");
    }
    return NextResponse.json({
      filePath,
      exists,
      content,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseBody(aiwSettingsSchema, body);
    if (!parsed.success) return parsed.response;
    const { content } = parsed.data;

    // Validate YAML syntax
    if (content.trim()) {
      try {
        const yamlParsed = parseYaml(content);
        if (yamlParsed !== null && typeof yamlParsed !== "object") {
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
    const filePath = getConfigFilePath();
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write config file
    fs.writeFileSync(filePath, content, "utf-8");

    // Invalidate cached config so the app picks up changes immediately
    _resetConfig();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
