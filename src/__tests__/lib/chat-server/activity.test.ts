import { describe, it, expect } from "vitest";
import {
  isSessionBusy,
  takeSessionsTurnedWaiting,
  type ChatActivityState,
} from "@/lib/chat-server/activity";
import { CHAT_BUSY_IDLE_MS, CHAT_NOTIFY_MIN_WORK_MS } from "@/lib/chat-server/constants";

const NOW = 1_700_000_000_000;

function session(overrides: Partial<ChatActivityState> = {}): ChatActivityState {
  return {
    id: "chat-1",
    workspaceId: "ws-a",
    exited: false,
    // Quiet long enough to count as waiting, after a turn long enough to
    // count as work.
    lastInputAt: NOW - CHAT_BUSY_IDLE_MS - CHAT_NOTIFY_MIN_WORK_MS - 1000,
    lastOutputAt: NOW - CHAT_BUSY_IDLE_MS - 1,
    waitingDecidedForOutputAt: null,
    ...overrides,
  };
}

describe("isSessionBusy", () => {
  it("is busy while the PTY wrote within the idle threshold", () => {
    expect(isSessionBusy({ lastOutputAt: NOW - CHAT_BUSY_IDLE_MS + 1 }, NOW)).toBe(true);
  });

  it("is not busy once the PTY has been quiet for the threshold", () => {
    expect(isSessionBusy({ lastOutputAt: NOW - CHAT_BUSY_IDLE_MS }, NOW)).toBe(false);
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
    const s = session({ lastOutputAt: NOW });
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([]);
  });

  it("ignores an exited session", () => {
    const s = session({ exited: true });
    expect(takeSessionsTurnedWaiting([s], NOW)).toEqual([]);
  });
});
