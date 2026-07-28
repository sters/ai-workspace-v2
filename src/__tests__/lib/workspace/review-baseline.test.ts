import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  readPreviousReviewBaseline,
  writeReviewBaseline,
} from "@/lib/workspace/review-baseline";

describe("review baseline", () => {
  let wsPath: string;

  function reviewsDir(): string {
    return path.join(wsPath, "artifacts", "reviews");
  }

  function seedSession(timestamp: string, heads: Record<string, string> | null) {
    const dir = path.join(reviewsDir(), timestamp);
    fs.mkdirSync(dir, { recursive: true });
    // Every real session has a SUMMARY.md; sessions predating baselines have no
    // baseline.json, which is the fallback path that must stay reviewable.
    fs.writeFileSync(path.join(dir, "SUMMARY.md"), "# Summary\n");
    if (heads) {
      fs.writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ heads }));
    }
  }

  beforeEach(() => {
    wsPath = fs.mkdtempSync(path.join("/tmp", "aiw-review-baseline-"));
  });

  afterEach(() => {
    fs.rmSync(wsPath, { recursive: true, force: true });
  });

  it("round-trips the heads it wrote", async () => {
    fs.mkdirSync(path.join(reviewsDir(), "20260101-000000"), { recursive: true });
    await writeReviewBaseline(wsPath, "20260101-000000", { "repo-a": "aaa111" });

    const found = await readPreviousReviewBaseline(wsPath, "20260102-000000");
    expect(found).toEqual({ timestamp: "20260101-000000", heads: { "repo-a": "aaa111" } });
  });

  it("returns null when no session has a baseline", async () => {
    seedSession("20260101-000000", null);
    expect(await readPreviousReviewBaseline(wsPath, "20260102-000000")).toBeNull();
  });

  it("returns null when the workspace has no reviews at all", async () => {
    expect(await readPreviousReviewBaseline(wsPath, "20260102-000000")).toBeNull();
  });

  // The current review's own directory already exists by the time the baseline is
  // read (prepareReviewDir creates it first), so a `<=` comparison would make a
  // review its own baseline and produce an empty diff.
  it("ignores the current review session and anything newer", async () => {
    seedSession("20260101-000000", { "repo-a": "old111" });
    seedSession("20260103-000000", { "repo-a": "current1" });
    seedSession("20260104-000000", { "repo-a": "future1" });

    const found = await readPreviousReviewBaseline(wsPath, "20260103-000000");
    expect(found?.timestamp).toBe("20260101-000000");
    expect(found?.heads["repo-a"]).toBe("old111");
  });

  it("picks the newest prior session, not the first one found", async () => {
    seedSession("20260101-000000", { "repo-a": "oldest1" });
    seedSession("20260102-000000", { "repo-a": "newest1" });

    const found = await readPreviousReviewBaseline(wsPath, "20260103-000000");
    expect(found?.timestamp).toBe("20260102-000000");
  });

  // A session that recorded a baseline for a repo added later is still the right
  // baseline for the repos it does cover, so skipping the whole session would
  // needlessly widen the review for all of them.
  it("skips a session whose baseline is unreadable and falls back to an older one", async () => {
    seedSession("20260101-000000", { "repo-a": "good111" });
    const brokenDir = path.join(reviewsDir(), "20260102-000000");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "baseline.json"), "{ not json");

    const found = await readPreviousReviewBaseline(wsPath, "20260103-000000");
    expect(found?.timestamp).toBe("20260101-000000");
  });

  it("skips a session whose baseline records no heads", async () => {
    seedSession("20260101-000000", { "repo-a": "good111" });
    seedSession("20260102-000000", {});

    const found = await readPreviousReviewBaseline(wsPath, "20260103-000000");
    expect(found?.timestamp).toBe("20260101-000000");
  });
});
