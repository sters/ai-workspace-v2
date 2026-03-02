import { describe, it, expect } from "vitest";
import {
  trimBuffer,
  gcSessions,
  BUFFER_HIGH,
  BUFFER_LOW,
  GC_MAX_AGE_MS,
  GC_MAX_EXITED,
} from "@/lib/chat-server";

// Minimal ChatSession stub for GC tests
function makeSession(
  id: string,
  overrides: { exited?: boolean; exitedAt?: number | null } = {},
) {
  return {
    id,
    workspaceId: "test",
    proc: {} as never,
    listeners: new Set() as never,
    exited: overrides.exited ?? false,
    exitCode: overrides.exited ? 0 : null,
    outputBuffer: [],
    activeWs: null,
    exitedAt: overrides.exitedAt ?? null,
  };
}

describe("trimBuffer", () => {
  it("returns the same buffer when under the high watermark", () => {
    const buf = Array.from({ length: 100 }, (_, i) => `chunk-${i}`);
    const result = trimBuffer(buf);
    expect(result).toBe(buf); // same reference — no copy
    expect(result).toHaveLength(100);
  });

  it("returns the same buffer at exactly the high watermark", () => {
    const buf = Array.from({ length: BUFFER_HIGH }, (_, i) => `chunk-${i}`);
    const result = trimBuffer(buf);
    expect(result).toBe(buf);
    expect(result).toHaveLength(BUFFER_HIGH);
  });

  it("trims to BUFFER_LOW when exceeding BUFFER_HIGH", () => {
    const total = BUFFER_HIGH + 500;
    const buf = Array.from({ length: total }, (_, i) => `chunk-${i}`);
    const result = trimBuffer(buf);
    expect(result).toHaveLength(BUFFER_LOW);
    // Should keep the most recent chunks
    expect(result[0]).toBe(`chunk-${total - BUFFER_LOW}`);
    expect(result[result.length - 1]).toBe(`chunk-${total - 1}`);
  });
});

describe("gcSessions", () => {
  it("removes sessions that exited more than GC_MAX_AGE_MS ago", () => {
    const now = Date.now();
    const sessions = new Map([
      ["old", makeSession("old", { exited: true, exitedAt: now - GC_MAX_AGE_MS - 1 })],
      ["recent", makeSession("recent", { exited: true, exitedAt: now - 1000 })],
      ["running", makeSession("running", { exited: false })],
    ]);

    const removed = gcSessions(sessions, now);

    expect(removed).toBe(1);
    expect(sessions.has("old")).toBe(false);
    expect(sessions.has("recent")).toBe(true);
    expect(sessions.has("running")).toBe(true);
  });

  it("does not remove running sessions regardless of age", () => {
    const now = Date.now();
    const sessions = new Map([
      ["running", makeSession("running", { exited: false })],
    ]);

    const removed = gcSessions(sessions, now);
    expect(removed).toBe(0);
    expect(sessions.has("running")).toBe(true);
  });

  it("limits exited sessions to GC_MAX_EXITED, removing oldest first", () => {
    const now = Date.now();
    const sessions = new Map<string, ReturnType<typeof makeSession>>();

    // Create GC_MAX_EXITED + 5 exited sessions, all within age limit
    const total = GC_MAX_EXITED + 5;
    for (let i = 0; i < total; i++) {
      const id = `s-${i}`;
      sessions.set(
        id,
        makeSession(id, { exited: true, exitedAt: now - (total - i) * 1000 }),
      );
    }

    const removed = gcSessions(sessions, now);

    expect(removed).toBe(5);
    expect(sessions.size).toBe(GC_MAX_EXITED);

    // The oldest 5 should be gone (s-0 through s-4)
    for (let i = 0; i < 5; i++) {
      expect(sessions.has(`s-${i}`)).toBe(false);
    }
    // The newest should remain
    for (let i = 5; i < total; i++) {
      expect(sessions.has(`s-${i}`)).toBe(true);
    }
  });

  it("combines age-based and count-based removal", () => {
    const now = Date.now();
    const sessions = new Map<string, ReturnType<typeof makeSession>>();

    // 3 very old sessions (should be removed by age)
    for (let i = 0; i < 3; i++) {
      const id = `old-${i}`;
      sessions.set(
        id,
        makeSession(id, { exited: true, exitedAt: now - GC_MAX_AGE_MS - (i + 1) * 1000 }),
      );
    }

    // GC_MAX_EXITED recent exited sessions (should all survive count check)
    for (let i = 0; i < GC_MAX_EXITED; i++) {
      const id = `recent-${i}`;
      sessions.set(
        id,
        makeSession(id, { exited: true, exitedAt: now - (i + 1) * 1000 }),
      );
    }

    const removed = gcSessions(sessions, now);

    // All 3 old ones removed by age check
    expect(removed).toBe(3);
    expect(sessions.size).toBe(GC_MAX_EXITED);
  });

  it("returns 0 when no sessions need cleanup", () => {
    const now = Date.now();
    const sessions = new Map([
      ["a", makeSession("a", { exited: true, exitedAt: now - 1000 })],
      ["b", makeSession("b", { exited: false })],
    ]);

    const removed = gcSessions(sessions, now);
    expect(removed).toBe(0);
    expect(sessions.size).toBe(2);
  });
});
