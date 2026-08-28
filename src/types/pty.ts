export type DataListener = (data: string, rawData: Uint8Array) => void;

/**
 * Bun.spawn with terminal option returns a subprocess with PTY control.
 * Type definitions may lag behind runtime support, so we define our own interface.
 */
export interface TerminalSubprocess {
  // `resize` is optional because an older Bun's `terminal` object has no such
  // method; callers reach it through `resizeTerminal()` rather than directly.
  terminal: { write(data: string): void; resize?(cols: number, rows: number): void };
  kill(): void;
  exited: Promise<number>;
}

export interface SpawnTerminalOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
}

export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
