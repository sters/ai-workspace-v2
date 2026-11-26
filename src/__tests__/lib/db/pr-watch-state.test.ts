import { describe, expect, it, beforeEach } from "bun:test";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { loadWatchState, saveWatchState } from "@/lib/db/pr-watch";
import { emptyWatchState } from "@/lib/pr-watcher/scheduler";

describe("db/pr-watch state", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("has nothing before the first pass, and returns what the last pass saved", () => {
    expect(loadWatchState()).toBeNull();
    saveWatchState({ ...emptyWatchState(), lastSweep: 1 });
    saveWatchState({ ...emptyWatchState(), lastSweep: 2, baseShas: { "acme/widgets\0main": "abc" } });
    expect(loadWatchState()).toEqual({ ...emptyWatchState(), lastSweep: 2, baseShas: { "acme/widgets\0main": "abc" } });
  });
});
