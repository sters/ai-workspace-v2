import { CHAT_BUSY_IDLE_MS, CHAT_NOTIFY_MIN_WORK_MS } from "./constants";

/**
 * Whether Claude has a turn open, read out of the PTY stream.
 *
 * Claude's TUI brackets every turn with the OSC 9;4 terminal-progress marker:
 * `ESC ] 9;4;3; BEL` (indeterminate) when the turn starts, `ESC ] 9;4;0; BEL`
 * (cleared) when it returns to the prompt — measured across a session's second
 * and third turns, not just the opening one.
 */
export interface TurnProgress {
  /** `null` until a marker has been seen at all. */
  inFlight: boolean | null;
  /** Trailing bytes held back in case a marker straddles two PTY chunks. */
  pending: string;
}

/** A session whose TUI has not written a progress marker yet. */
export const UNKNOWN_TURN_PROGRESS: TurnProgress = { inFlight: null, pending: "" };

// eslint-disable-next-line no-control-regex
const TURN_PROGRESS_MARKER = /\x1b\]9;4;(\d)/g;
/** One byte short of the shortest marker — what could still be a marker's head. */
const MARKER_HEAD_MAX = "\x1b]9;4;".length;

/**
 * Fold a PTY chunk into the turn state. Only a marker moves it, so a chunk of
 * ordinary frames leaves it alone.
 *
 * The chunk is scanned with the previous chunk's tail in front of it, since a
 * marker can be split across a chunk boundary. Re-scanning a marker that was
 * already applied is harmless: the state it sets is the same, and any newer
 * marker in this chunk comes after it in the string.
 */
export function readTurnProgress(chunk: string, prev: TurnProgress): TurnProgress {
  const text = prev.pending + chunk;
  let inFlight = prev.inFlight;
  for (const match of text.matchAll(TURN_PROGRESS_MARKER)) {
    // OSC 9;4 state 0 clears the progress indicator; every other state sets one.
    inFlight = match[1] !== "0";
  }
  return { inFlight, pending: text.slice(-MARKER_HEAD_MAX) };
}

/** The part of a `ChatSession` that decides what it is doing. */
export interface ChatActivityState {
  id: string;
  workspaceId: string;
  exited: boolean;
  lastOutputAt: number;
  lastInputAt: number;
  progress: TurnProgress;
  /**
   * The `lastOutputAt` whose quiet period has already been judged, so a tick
   * that lands every second does not re-notify the same wait. Keyed on the
   * output rather than on a boolean because re-arming then needs no tick to
   * land while the session was busy.
   */
  waitingDecidedForOutputAt: number | null;
}

/**
 * Whether a session is working rather than waiting for the user to type.
 * The one predicate behind both the sidebar's `busy` flag and the
 * turned-waiting notification, so the two cannot disagree about what silence
 * means.
 *
 * Both halves are needed, and each covers a state the other gets wrong.
 * Silence alone counts *any* PTY output as work, and an idle session writes
 * plenty: it echoes every keystroke, repaints on the SIGWINCH a sidebar
 * collapse raises, and answers focus reports and mouse events the browser
 * terminal sends — measured on an idle session, all of them output, none of
 * them work. The marker alone is wrong in the mirror case: Claude blocked on a
 * permission prompt keeps its turn open, so progress stays set while the thing
 * being waited on is the human.
 *
 * An unknown turn state means silence decides, so a Claude build or terminal
 * that writes no marker behaves as before rather than reading as idle forever.
 */
export function isSessionBusy(
  session: { lastOutputAt: number; progress?: TurnProgress },
  now: number,
): boolean {
  if (session.progress?.inFlight === false) return false;
  return now - session.lastOutputAt < CHAT_BUSY_IDLE_MS;
}

/**
 * The sessions that have just stopped working — the busy→waiting transition the
 * sidebar indicator renders as blue→muted — marking each as judged so it is
 * reported once per turn.
 *
 * A quiet period is only worth a notification when the session *worked* through
 * it. The PTY also echoes every keystroke, so a burst of typing looks exactly
 * like output; what separates the two is that an echo arrives milliseconds
 * after its input, where a turn's last output comes long after the Enter that
 * started it. `CHAT_NOTIFY_MIN_WORK_MS` is that gap, and it doubles as the "the
 * user is still watching" cutoff for a turn that finished in seconds.
 */
export function takeSessionsTurnedWaiting<T extends ChatActivityState>(
  sessions: Iterable<T>,
  now: number,
): T[] {
  const turned: T[] = [];
  for (const session of sessions) {
    if (session.exited) continue;
    if (isSessionBusy(session, now)) continue;
    if (session.waitingDecidedForOutputAt === session.lastOutputAt) continue;
    session.waitingDecidedForOutputAt = session.lastOutputAt;
    if (session.lastOutputAt - session.lastInputAt < CHAT_NOTIFY_MIN_WORK_MS) continue;
    turned.push(session);
  }
  return turned;
}
