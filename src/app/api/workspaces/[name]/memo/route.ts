import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { memoSaveSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

function getMemoPath(name: string): string {
  return path.join(getWorkspaceDir(), name, "artifacts", "memo.md");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const memoPath = getMemoPath(name);
  const content = fs.existsSync(memoPath)
    ? fs.readFileSync(memoPath, "utf-8")
    : "";

  return NextResponse.json({ content });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ error: "Invalid workspace name" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(memoSaveSchema, body);
  if (!parsed.success) return parsed.response;

  const memoPath = getMemoPath(name);
  fs.mkdirSync(path.dirname(memoPath), { recursive: true });
  fs.writeFileSync(memoPath, parsed.data.content, "utf-8");

  return NextResponse.json({ ok: true });
}
