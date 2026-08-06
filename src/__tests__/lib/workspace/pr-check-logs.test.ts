import { describe, it, expect } from "vitest";
import {
  excerptFailureLog,
  MAX_LOG_CHARS,
  MAX_LOG_LINES,
  parseCheckRunRef,
} from "@/lib/workspace/pr-check-logs";

describe("parseCheckRunRef", () => {
  it("reads the job id out of a GitHub Actions check url", () => {
    expect(
      parseCheckRunRef("https://github.com/acme/widgets/actions/runs/123/job/456"),
    ).toEqual({ kind: "job", id: "456" });
  });

  it("keeps working on an enterprise host", () => {
    expect(
      parseCheckRunRef("https://git.acme.internal/acme/widgets/actions/runs/1/job/2"),
    ).toEqual({ kind: "job", id: "2" });
  });

  it("falls back to the run when the url names no job", () => {
    expect(parseCheckRunRef("https://github.com/acme/widgets/actions/runs/123")).toEqual({
      kind: "run",
      id: "123",
    });
  });

  it("ignores a fragment or query after the job id", () => {
    expect(
      parseCheckRunRef("https://github.com/a/b/actions/runs/1/job/2?check_suite_focus=true"),
    ).toEqual({ kind: "job", id: "2" });
  });

  // An external CI's log lives on that CI, so there is nothing `gh` can fetch —
  // the instruction has to say so rather than pretend the log was empty.
  it("returns null for a check hosted outside GitHub Actions", () => {
    expect(parseCheckRunRef("https://circleci.com/gh/acme/widgets/9001")).toBeNull();
    expect(parseCheckRunRef(null)).toBeNull();
    expect(parseCheckRunRef("")).toBeNull();
  });
});

describe("excerptFailureLog", () => {
  it("strips the job/step/timestamp prefix gh puts on every line", () => {
    const raw = [
      "test\tRun tests\t2026-08-06T01:02:03.1234567Z FAIL src/cache.test.ts",
      "test\tRun tests\t2026-08-06T01:02:04.1234567Z   expected 1, got 2",
    ].join("\n");

    const { text } = excerptFailureLog(raw);
    expect(text).toBe("FAIL src/cache.test.ts\n  expected 1, got 2");
  });

  it("leaves a line that carries no prefix alone", () => {
    expect(excerptFailureLog("error: undefined variable x").text).toBe(
      "error: undefined variable x",
    );
  });

  it("keeps the tail rather than the head, and says it truncated", () => {
    const raw = Array.from({ length: MAX_LOG_LINES + 40 }, (_, i) => `line ${i}`).join("\n");
    const { text, truncated } = excerptFailureLog(raw);

    expect(truncated).toBe(true);
    // The error a test run reports last is the one worth quoting.
    expect(text).toContain(`line ${MAX_LOG_LINES + 39}`);
    expect(text).not.toContain("line 0\n");
    expect(text.split("\n")).toHaveLength(MAX_LOG_LINES);
  });

  it("caps the character count too, since one line can be enormous", () => {
    const { text, truncated } = excerptFailureLog("x".repeat(MAX_LOG_CHARS * 2));
    expect(text.length).toBeLessThanOrEqual(MAX_LOG_CHARS);
    expect(truncated).toBe(true);
  });

  it("drops blank and group-marker noise", () => {
    const raw = ["##[group]Run tests", "", "boom", "##[endgroup]"].join("\n");
    expect(excerptFailureLog(raw).text).toBe("boom");
  });

  it("reports an empty log as empty rather than as a line of whitespace", () => {
    expect(excerptFailureLog("   \n\n  ").text).toBe("");
  });
});
