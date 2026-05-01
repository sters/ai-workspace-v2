import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  getConfigFilePath,
  normalizeRawConfig,
  validateOpeners,
  ConfigValidationError,
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

    // Validate YAML syntax + known schema constraints (openers shape).
    if (content.trim()) {
      let yamlParsed: unknown;
      try {
        yamlParsed = parseYaml(content);
      } catch (err) {
        return NextResponse.json(
          { error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }
      if (yamlParsed !== null && typeof yamlParsed !== "object") {
        return NextResponse.json(
          { error: "Config must be a YAML mapping (object), not a scalar or array" },
          { status: 400 },
        );
      }
      if (yamlParsed && typeof yamlParsed === "object" && !Array.isArray(yamlParsed)) {
        // normalizeRawConfig migrates legacy `editor`/`terminal` into `openers`,
        // so we validate the post-migration shape — matches what the runtime
        // would actually consume.
        const normalized = normalizeRawConfig(yamlParsed as Record<string, unknown>);
        if (normalized.openers !== undefined) {
          try {
            validateOpeners(normalized.openers);
          } catch (err) {
            if (err instanceof ConfigValidationError) {
              return NextResponse.json({ error: err.message }, { status: 400 });
            }
            throw err;
          }
        }
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
