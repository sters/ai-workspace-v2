// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { recordWorkerJobStart, recordWorkerJobFinish, listWorkerJobRuns } from "@/lib/db/worker-jobs";

describe("db/worker-jobs", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("keeps a failure visible until the next tick succeeds", () => {
    recordWorkerJobStart("pr-watcher", "2026-11-19T09:00:00.000Z");
    recordWorkerJobFinish("pr-watcher", "2026-11-19T09:00:05.000Z", "gh: rate limited");
    recordWorkerJobStart("pr-watcher", "2026-11-19T09:01:00.000Z");
    expect(listWorkerJobRuns().get("pr-watcher")).toMatchObject({
      lastStartedAt: "2026-11-19T09:01:00.000Z",
      lastFinishedAt: "2026-11-19T09:00:05.000Z",
      lastError: "gh: rate limited",
    });

    recordWorkerJobFinish("pr-watcher", "2026-11-19T09:01:03.000Z", null);
    expect(listWorkerJobRuns().get("pr-watcher")!.lastError).toBeNull();
  });
});
