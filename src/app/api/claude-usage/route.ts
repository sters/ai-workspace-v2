import { NextResponse } from "next/server";
import { spawnClaudeTerminal } from "@/lib/claude/cli";
import { collectOutput } from "@/lib/pty";
import type { DataListener } from "@/types/pty";

export const dynamic = "force-dynamic";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cols = Math.max(40, Math.min(300, Number(searchParams.get("cols")) || 120));
  const rows = Math.max(10, Math.min(100, Number(searchParams.get("rows")) || 40));

  const listeners = new Set<DataListener>();
  let proc: ReturnType<typeof spawnClaudeTerminal> | null = null;

  try {
    proc = spawnClaudeTerminal({
      args: ["--system-prompt", ""],
      listeners,
      cols,
      rows,
    });

    // Wait for Claude CLI startup to settle
    await collectOutput(listeners, 3000, 15000);

    // Send /usage command (input then Enter separately, like mcp-auth)
    proc.terminal.write("/usage");
    await delay(500);
    proc.terminal.write("\r");

    // Collect usage output (raw, with ANSI codes for xterm rendering)
    const rawOutput = await collectOutput(listeners, 3000, 30000);

    // Clean up
    proc.kill();

    return NextResponse.json({ usage: rawOutput });
  } catch (err) {
    proc?.kill();
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
