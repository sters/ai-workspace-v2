import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import z from "zod";
import { parse as parseYaml } from "yaml";
import {
  CONFIG_FILE_PATH,
  _resetConfig,
} from "@/lib/config";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

const aiwSettingsSchema = z.object({
  content: z.string({
    required_error: "content is required",
    invalid_type_error: "content is required",
  }),
});

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
