import type { SpawnResult } from "@/types/pty";

/** Spawn `claude auth <subcommand>` via Bun.spawn with piped stdio. */
export function spawnClaudeAuth(subcommand: string): SpawnResult {
  return Bun.spawn(["claude", "auth", subcommand], {
    stdout: "pipe",
    stderr: "pipe",
  }) as SpawnResult;
}

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
    }, new Uint8Array()),
  );
}

/**
 * Check current auth status via `claude auth status`.
 * Returns the trimmed stdout output.
 */
export async function checkAuthStatus(): Promise<string> {
  const proc = spawnClaudeAuth("status");

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Exit code ${exitCode}`);
  }
  return stdout.trim();
}
