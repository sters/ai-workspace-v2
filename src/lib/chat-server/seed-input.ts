/**
 * Typing text the caller already wrote into a chat session's prompt box.
 *
 * The text is put in the box and left there, unsent: the caller wrote it in a
 * form field, so the last read of it belongs to the human in front of the
 * terminal, who may edit it or press Enter.
 *
 * It arrives as a **bracketed paste** (`ESC [ 200~ … ESC [ 201~`) rather than
 * as keystrokes, which is what makes a multi-line note safe to seed: the TUI
 * enables bracketed-paste mode on startup and treats everything between the
 * markers as literal content, where a bare CR among plain keystrokes is Enter
 * and would submit the text half-written.
 */

import type { DataListener } from "@/types/pty";
import { CHAT_BUSY_IDLE_MS } from "./constants";

/** Cap on the seeded text. This goes into a prompt box, not a file. */
export const SEED_INPUT_MAX_CHARS = 4000;

/**
 * How long to wait for quiet before seeding anyway.
 *
 * Reaching it means the session never stopped drawing — a first turn doing real
 * work, or a TUI redrawing on a timer of its own. Seeding then is still right:
 * text typed while Claude works lands in the box exactly as it does when a
 * human types during a turn. Losing it would be the worse answer.
 */
export const SEED_INPUT_MAX_WAIT_MS = 120_000;

/**
 * Strip what would break out of the paste or submit the box.
 *
 * `ESC` is the byte that matters: a note containing the paste-end marker would
 * end the paste early and leave the rest arriving as keystrokes, where a CR
 * sends whatever is in the box. The text is a form field's contents, so it has
 * no business carrying control bytes at all — tabs and line breaks excepted.
 */
export function sanitizeSeedInput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trim()
    .slice(0, SEED_INPUT_MAX_CHARS);
}

/** Wrap text so the TUI reads it as pasted content rather than as keystrokes. */
export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

export interface SeedInputParams {
  /** Raw text as the caller wrote it; sanitized here. */
  text: string;
  /** The session's output listeners — silence in them is the readiness signal. */
  listeners: Set<DataListener>;
  write: (data: string) => void;
  isExited: () => boolean;
  settleMs?: number;
  maxWaitMs?: number;
}

/**
 * Seed the prompt box once the session stops drawing, and return a disposer.
 *
 * Quiet is the readiness signal for the same reason `CHAT_BUSY_IDLE_MS` uses
 * it: Claude's TUI repaints at least once a second while it works and not at
 * all while the prompt waits, and the output is a byte stream rather than a
 * screen, so no marker in it can say what is currently displayed.
 */
export function scheduleSeedInput(params: SeedInputParams): () => void {
  const text = sanitizeSeedInput(params.text);
  if (!text) return () => {};

  const settleMs = params.settleMs ?? CHAT_BUSY_IDLE_MS;
  const maxWaitMs = params.maxWaitMs ?? SEED_INPUT_MAX_WAIT_MS;

  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const listener: DataListener = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(seed, settleMs);
  };

  const dispose = () => {
    clearTimeout(settleTimer);
    clearTimeout(deadlineTimer);
    params.listeners.delete(listener);
  };

  function seed() {
    dispose();
    if (params.isExited()) return;
    params.write(bracketedPaste(text));
  }

  params.listeners.add(listener);
  settleTimer = setTimeout(seed, settleMs);
  // Declared after `dispose` closes over it: both fire from a timer or a
  // listener, so neither can run before this line has assigned it.
  const deadlineTimer = setTimeout(seed, maxWaitMs);

  return dispose;
}
