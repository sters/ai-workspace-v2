/**
 * PTY utilities for spawning terminal processes via Bun.spawn's terminal option.
 * Shared between mcp-auth.ts and chat-server.ts.
 */

export type DataListener = (data: string) => void;

/**
 * Bun.spawn with terminal option returns a subprocess with PTY control.
 * Type definitions may lag behind runtime support, so we define our own interface.
 */
export interface TerminalSubprocess {
  terminal: { write(data: string): void };
  kill(): void;
  exited: Promise<number>;
}

export interface SpawnTerminalOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
}

export function spawnTerminal(
  cmd: string[],
  options: SpawnTerminalOptions,
  listeners: Set<DataListener>,
): TerminalSubprocess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Bun.spawn as any)(cmd, {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
      data(_terminal: unknown, rawData: Uint8Array) {
        const text = new TextDecoder().decode(rawData);
        for (const fn of listeners) fn(text);
      },
    },
  }) as TerminalSubprocess;
}

/**
 * Collect output from the terminal, waiting until output stabilizes
 * (no new data for `settleMs`) or `maxMs` elapses.
 */
export function collectOutput(
  listeners: Set<DataListener>,
  settleMs = 2000,
  maxMs = 30000,
): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      listeners.delete(listener);
      resolve(buffer);
    };

    const listener: DataListener = (data: string) => {
      buffer += data;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settleMs);
    };

    listeners.add(listener);

    // If no data arrives at all, resolve after settleMs
    settleTimer = setTimeout(finish, settleMs);
    // Absolute max timeout
    const maxTimer = setTimeout(finish, maxMs);
  });
}
