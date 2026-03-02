/**
 * PTY utilities for spawning terminal processes via Bun.spawn's terminal option.
 * Shared between mcp-auth.ts and chat-server.ts.
 */

import type { DataListener, TerminalSubprocess, SpawnTerminalOptions } from "@/types/pty";

export function spawnTerminal(
  cmd: string[],
  options: SpawnTerminalOptions,
  listeners: Set<DataListener>,
): TerminalSubprocess {
  // Single streaming decoder so multi-byte UTF-8 characters split across
  // PTY chunks are buffered instead of replaced with U+FFFD.
  const decoder = new TextDecoder();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Bun.spawn as any)(cmd, {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
      data(_terminal: unknown, rawData: Uint8Array) {
        const text = decoder.decode(rawData, { stream: true });
        for (const fn of listeners) fn(text, rawData);
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
