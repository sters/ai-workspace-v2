import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataListener } from "@/types/pty";
import {
  SEED_INPUT_MAX_CHARS,
  SEED_INPUT_MAX_WAIT_MS,
  bracketedPaste,
  sanitizeSeedInput,
  scheduleSeedInput,
} from "@/lib/chat-server/seed-input";
import { CHAT_BUSY_IDLE_MS } from "@/lib/chat-server/constants";

describe("sanitizeSeedInput", () => {
  it("keeps the text the user wrote, line breaks included", () => {
    expect(sanitizeSeedInput("fix the login crash\nthe refresh path 500s")).toBe(
      "fix the login crash\nthe refresh path 500s",
    );
  });

  it("normalizes CRLF and bare CR to LF, so no line ends up submitting the box", () => {
    expect(sanitizeSeedInput("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("drops the escapes that would close the paste and type the rest raw", () => {
    const escaped = sanitizeSeedInput("safe\x1b[201~\rrm -rf /");
    expect(escaped).not.toContain("\x1b");
    expect(escaped).not.toContain("\r");
    expect(escaped).toBe("safe[201~\nrm -rf /");
  });

  it("drops other control bytes but keeps tabs", () => {
    expect(sanitizeSeedInput("a\x00b\x07c\td\x7f")).toBe("abc\td");
  });

  it("trims and reports empty text as nothing to seed", () => {
    expect(sanitizeSeedInput("  \n\t ")).toBe("");
    expect(sanitizeSeedInput("")).toBe("");
  });

  it("caps the length, since this is typed into a prompt box", () => {
    expect(sanitizeSeedInput("x".repeat(SEED_INPUT_MAX_CHARS + 500))).toHaveLength(
      SEED_INPUT_MAX_CHARS,
    );
  });
});

describe("bracketedPaste", () => {
  it("wraps the text in the paste markers the TUI reads as literal content", () => {
    expect(bracketedPaste("hello\nworld")).toBe("\x1b[200~hello\nworld\x1b[201~");
  });
});

describe("scheduleSeedInput", () => {
  let listeners: Set<DataListener>;
  let write: ReturnType<typeof vi.fn>;
  let exited: boolean;

  const emit = () => {
    for (const fn of listeners) fn("frame", new Uint8Array());
  };

  const schedule = (text: string) =>
    scheduleSeedInput({
      text,
      listeners,
      write,
      isExited: () => exited,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Set();
    write = vi.fn();
    exited = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the TUI to go quiet before typing, then seeds once", () => {
    schedule("fix the login crash");

    vi.advanceTimersByTime(CHAT_BUSY_IDLE_MS - 1);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(bracketedPaste("fix the login crash"));

    vi.advanceTimersByTime(SEED_INPUT_MAX_WAIT_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("holds off while the session is still drawing", () => {
    schedule("later");

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(CHAT_BUSY_IDLE_MS - 500);
      emit();
    }
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CHAT_BUSY_IDLE_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("seeds at the deadline rather than losing the text to a session that never goes quiet", () => {
    schedule("stubborn");

    const tick = CHAT_BUSY_IDLE_MS - 100;
    for (let elapsed = 0; elapsed < SEED_INPUT_MAX_WAIT_MS; elapsed += tick) {
      vi.advanceTimersByTime(tick);
      emit();
    }

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(bracketedPaste("stubborn"));
  });

  it("does not type into a process that has exited", () => {
    schedule("gone");
    exited = true;

    vi.advanceTimersByTime(SEED_INPUT_MAX_WAIT_MS);
    expect(write).not.toHaveBeenCalled();
  });

  it("stops listening and never writes once disposed", () => {
    const dispose = schedule("cancelled");
    expect(listeners.size).toBe(1);

    dispose();

    expect(listeners.size).toBe(0);
    vi.advanceTimersByTime(SEED_INPUT_MAX_WAIT_MS);
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves no listener behind after it has seeded", () => {
    schedule("done");
    vi.advanceTimersByTime(CHAT_BUSY_IDLE_MS);

    expect(write).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("schedules nothing when the text has nothing left after sanitizing", () => {
    const dispose = schedule("  \r\n ");

    expect(listeners.size).toBe(0);
    vi.advanceTimersByTime(SEED_INPUT_MAX_WAIT_MS);
    expect(write).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });
});
