export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

/** Spawn `claude auth <subcommand>` via Bun.spawn with piped stdio. */
export function spawnClaudeAuth(subcommand: string): SpawnResult {
  return Bun.spawn(["claude", "auth", subcommand], {
    stdout: "pipe",
    stderr: "pipe",
  }) as SpawnResult;
}
