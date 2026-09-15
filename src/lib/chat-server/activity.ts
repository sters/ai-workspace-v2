import { CHAT_BUSY_IDLE_MS, CHAT_NOTIFY_MIN_WORK_MS } from "./constants";

/** The part of a `ChatSession` that decides what it is doing. */
export interface ChatActivityState {
  id: string;
  workspaceId: string;
  exited: boolean;
  lastOutputAt: number;
  lastInputAt: number;
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
 */
export function isSessionBusy(session: { lastOutputAt: number }, now: number): boolean {
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
