// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectHumanCommits } from "@/lib/lessons/material";

const commit = (oid: string, committedDate: string) => ({ oid, committedDate, messageHeadline: oid });

describe("selectHumanCommits", () => {
  const windows = [
    { startedAt: "2026-01-01T10:00:00Z", completedAt: "2026-01-01T11:00:00Z" },
    { startedAt: "2026-01-02T10:00:00Z" },
  ];

  it("keeps only commits made while no operation ran", () => {
    const picked = selectHumanCommits(
      [
        commit("during-op", "2026-01-01T10:30:00Z"),
        commit("between-ops", "2026-01-01T15:00:00Z"),
        commit("during-running-op", "2026-01-02T12:00:00Z"),
      ],
      windows,
      "2026-01-03T00:00:00Z",
    );
    expect(picked.map((c) => c.oid)).toEqual(["between-ops"]);
  });

  it("drops a commit whose date cannot be read rather than guessing who made it", () => {
    expect(selectHumanCommits([commit("x", "not a date")], [], "2026-01-03T00:00:00Z")).toEqual([]);
  });
});
