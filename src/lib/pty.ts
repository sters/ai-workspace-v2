/**
 * PTY utilities for spawning terminal processes via Bun.spawn's terminal option.
 * Shared between mcp-auth.ts and chat-server.ts.
 */

import type { DataListener, TerminalSubprocess, SpawnTerminalOptions } from "@/types/pty";

/** PTY size used when the caller has no real terminal to measure. */
export const DEFAULT_PTY_COLS = 120;
export const DEFAULT_PTY_ROWS = 40;

const MIN_PTY_COLS = 20;
const MAX_PTY_COLS = 500;
const MIN_PTY_ROWS = 5;
const MAX_PTY_ROWS = 300;

/**
 * Bound a browser-reported terminal size to something a TUI can draw in. An
 * xterm instance measured while its container is hidden or mid-transition
 * reports 0 or absurd dimensions, and a PTY sized from that makes the child
 * render into a viewport that does not exist.
 */
export function clampPtySize(cols: number, rows: number): { cols: number; rows: number } {
  const clamp = (v: number, min: number, max: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
  return {
    cols: clamp(cols, MIN_PTY_COLS, MAX_PTY_COLS, DEFAULT_PTY_COLS),
    rows: clamp(rows, MIN_PTY_ROWS, MAX_PTY_ROWS, DEFAULT_PTY_ROWS),
  };
}

/**
 * Resize a live PTY, which raises SIGWINCH in the child and makes a TUI repaint.
 * Returns false when the running Bun exposes no resize method, so the caller can
 * keep the size it recorded rather than assume the child was told.
 */
export function resizeTerminal(proc: TerminalSubprocess, cols: number, rows: number): boolean {
  if (typeof proc.terminal.resize !== "function") return false;
  proc.terminal.resize(cols, rows);
  return true;
}

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
      cols: options.cols ?? DEFAULT_PTY_COLS,
      rows: options.rows ?? DEFAULT_PTY_ROWS,
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
