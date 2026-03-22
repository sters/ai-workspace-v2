import { NextRequest, NextResponse } from "next/server";
import { getSettingsFilePath } from "@/lib/claude/settings";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { addPermissionSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = parseBody(addPermissionSchema, body);
  if (!parsed.success) return parsed.response;
  const { permission } = parsed.data;

  const filePath = getSettingsFilePath("local");

  try {
    // Read existing settings or start fresh
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let settings: any;
    try {
      const raw = await Bun.file(filePath).text();
      settings = JSON.parse(raw);
    } catch {
      settings = {};
    }

    // Ensure permissions.allow array exists
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    // Check for duplicates
    if (settings.permissions.allow.includes(permission)) {
      return NextResponse.json({ ok: true, alreadyExists: true });
    }

    // Add and write
    settings.permissions.allow.push(permission);
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify(settings, null, 2));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
