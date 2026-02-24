import { NextResponse } from "next/server";
import { cliPath } from "@/lib/claude-sdk";
import { AI_WORKSPACE_ROOT } from "@/lib/config";

export const dynamic = "force-dynamic";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array())
  );
}

export async function GET() {
  try {
    const proc = Bun.spawn([cliPath, "--version"], {
      cwd: AI_WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(proc.stdout as ReadableStream<Uint8Array>),
      readStream(proc.stderr as ReadableStream<Uint8Array>),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return NextResponse.json(
        { error: stderr.trim() || `Exit code ${exitCode}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ version: stdout.trim() });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
