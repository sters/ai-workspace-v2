import { describe, it, expect } from "vitest";
import {
  isSessionBusy,
  readTurnProgress,
  takeSessionsTurnedWaiting,
  UNKNOWN_TURN_PROGRESS,
  type ChatActivityState,
} from "@/lib/chat-server/activity";
import { CHAT_BUSY_IDLE_MS, CHAT_NOTIFY_MIN_WORK_MS } from "@/lib/chat-server/constants";

const NOW = 1_700_000_000_000;

/** The marker the TUI writes when a turn starts / stops. */
const TURN_START = "\x1b]9;4;3;\x07";
const TURN_END = "\x1b]9;4;0;\x07";

function session(overrides: Partial<ChatActivityState> = {}): ChatActivityState {
  return {
    id: "chat-1",
    workspaceId: "ws-a",
    exited: false,
    // Quiet long enough to count as waiting, after a turn long enough to
    // count as work.
    lastInputAt: NOW - CHAT_BUSY_IDLE_MS - CHAT_NOTIFY_MIN_WORK_MS - 1000,
    lastOutputAt: NOW - CHAT_BUSY_IDLE_MS - 1,
    progress: { inFlight: false, pending: "" },
    waitingDecidedForOutputAt: null,
    ...overrides,
  };
}

describe("readTurnProgress", () => {
  it("reads the start-of-turn marker as a turn in flight", () => {
    expect(readTurnProgress(`${TURN_START}frame`, UNKNOWN_TURN_PROGRESS).inFlight).toBe(true);
  });

  it("reads the cleared marker as no turn in flight", () => {
    expect(readTurnProgress(`⏺ Done.${TURN_END}`, { inFlight: true, pending: "" }).inFlight).toBe(
      false,
    );
  });

  it("keeps the last of several markers in one chunk", () => {
    const state = readTurnProgress(`${TURN_END}${TURN_START}`, UNKNOWN_TURN_PROGRESS);
    expect(state.inFlight).toBe(true);
  });

  it("holds the state through a chunk that carries no marker", () => {
    expect(readTurnProgress("⠐ Searching…", { inFlight: true, pending: "" }).inFlight).toBe(true);
  });

  it("reads a marker split across two chunks", () => {
    const first = readTurnProgress(`padding\x1b]9;4`, UNKNOWN_TURN_PROGRESS);
    expect(first.inFlight).toBe(null);
    expect(readTurnProgress(`;3;\x07`, first).inFlight).toBe(true);
  });

  it("starts out unknown, so a TUI that writes no marker is not called idle", () => {
    expect(readTurnProgress("plain frame", UNKNOWN_TURN_PROGRESS).inFlight).toBe(null);
  });
});

describe("isSessionBusy", () => {
  it("is busy while a turn is in flight and the PTY is still drawing", () => {
    expect(
      isSessionBusy(
        { lastOutputAt: NOW - CHAT_BUSY_IDLE_MS + 1, progress: { inFlight: true, pending: "" } },
        NOW,
      ),
    ).toBe(true);
  });

  it("is not busy once a running turn's PTY has been quiet for the threshold", () => {
    // Claude blocked on a permission prompt leaves the progress marker set: it
    // has a turn open, and is waiting for the human inside it.
    expect(
      isSessionBusy(
        { lastOutputAt: NOW - CHAT_BUSY_IDLE_MS, progress: { inFlight: true, pending: "" } },
        NOW,
      ),
    ).toBe(false);
  });

  it("is not busy when no turn is in flight, however recently the PTY wrote", () => {
    // Keystroke echo, a SIGWINCH repaint and a focus report are all PTY output
    // with nothing working behind them.
    expect(
      isSessionBusy({ lastOutputAt: NOW, progress: { inFlight: false, pending: "" } }, NOW),
    ).toBe(false);
  });

  it("falls back to silence alone while the turn state is unknown", () => {
    expect(isSessionBusy({ lastOutputAt: NOW, progress: UNKNOWN_TURN_PROGRESS }, NOW)).toBe(true);
    expect(
      isSessionBusy({ lastOutputAt: NOW - CHAT_BUSY_IDLE_MS, progress: UNKNOWN_TURN_PROGRESS }, NOW),
    ).toBe(false);
  });

  it("falls back to silence alone for a session with no turn state at all", () => {
    expect(isSessionBusy({ lastOutputAt: NOW }, NOW)).toBe(true);
  });
});

describe("takeSessionsTurnedWaiting", () => {
  it("reports a session that has gone quiet after working", () => {
    const s = session();
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([s]);
  });

  it("reports it once, not on every tick", () => {
    const s = session();
    takeSessionsTurnedWaiting([s], NOW);
    expect(takeSessionsTurnedWaiting([s], NOW + 1000)).toEqual([]);
  });

  it("reports the next turn, without needing a tick while it was busy", () => {
    const s = session();
    takeSessionsTurnedWaiting([s], NOW);

    s.lastInputAt = NOW;
    s.lastOutputAt = NOW + CHAT_NOTIFY_MIN_WORK_MS + 1000;
    expect(takeSessionsTurnedWaiting([s], s.lastOutputAt + CHAT_BUSY_IDLE_MS)).toEqual([s]);
  });

  it("ignores a quiet period that is only the echo of the user typing", () => {
    // Every keystroke echoes within milliseconds, so a burst of typing leaves
    // the last output right next to the last input — nothing worked here.
    const s = session({ lastInputAt: NOW - CHAT_BUSY_IDLE_MS - 50 });
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([]);
  });

  it("does not revisit a suppressed session on the next tick", () => {
    const s = session({ lastInputAt: NOW - CHAT_BUSY_IDLE_MS - 50 });
    takeSessionsTurnedWaiting([s], NOW);
    expect(takeSessionsTurnedWaiting([s], NOW + CHAT_NOTIFY_MIN_WORK_MS)).toEqual([]);
  });

  it("ignores a session that is still working", () => {
    const s = session({ lastOutputAt: NOW, progress: { inFlight: true, pending: "" } });
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([]);
  });

  it("ignores an exited session", () => {
    const s = session({ exited: true });
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([]);
  });
});
