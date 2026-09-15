/** Maximum output buffer chunks before trimming */
export const BUFFER_HIGH = 5000;
/** Number of chunks to keep after trim */
export const BUFFER_LOW = 3000;
/** GC: max age (ms) for exited sessions before cleanup */
export const GC_MAX_AGE_MS = 10 * 60 * 1000;
/** GC: max number of exited sessions to keep */
export const GC_MAX_EXITED = 10;
/** GC interval (ms) */
export const GC_INTERVAL_MS = 60 * 1000;
/**
 * Quiet time (ms) after which a chat session counts as waiting for input.
 *
 * Claude's TUI repaints its status line at least once a second while it works —
 * the elapsed-seconds counter alone forces it — and repaints nothing at all
 * while the prompt sits idle, so silence is the signal. Content cannot be: the
 * output buffer is a byte log rather than a screen, so a marker like
 * `esc to interrupt` stays in it from every earlier turn's redraw.
 */
export const CHAT_BUSY_IDLE_MS = 3000;
/**
 * How often the busy→waiting transition is looked for.
 *
 * Adds up to one interval to `CHAT_BUSY_IDLE_MS` before a session that stopped
 * working is notified about. One timer scans every session, the same shape as
 * the GC timer above.
 */
export const CHAT_WAITING_POLL_MS = 1000;
/**
 * How long a session must have been working for its return to the prompt to be
 * worth a push notification.
 *
 * Measured as the gap between the last input and the last output, which is what
 * tells a finished turn apart from the PTY echoing a burst of typing — see
 * `takeSessionsTurnedWaiting`. A turn shorter than this finished while the user
 * was still looking at the Enter they pressed.
 */
export const CHAT_NOTIFY_MIN_WORK_MS = 10_000;
