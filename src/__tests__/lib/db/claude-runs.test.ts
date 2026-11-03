// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { Database } from "bun:sqlite";
import { getDb, _resetDb, _setDbPath, runMigrations } from "@/lib/db";
import { insertClaudeRun, listClaudeRuns } from "@/lib/db/claude-runs";
import type { ClaudeRunInput } from "@/lib/db/claude-runs";

function run(overrides: Partial<ClaudeRunInput> = {}): ClaudeRunInput {
  return {
    operationId: "op-1",
    operationType: "autonomous",
    workspace: "ws-1",
    phaseLabel: "Cycle 1: Review",
    childLabel: "review-repo",
    stepType: "code-review",
    effort: "medium",
    model: "claude-opus-5-5",
    costUsd: 0.5,
    durationMs: 1000,
    numTurns: 3,
    inputTokens: 1,
    cacheCreationTokens: 2,
    cacheReadTokens: 3,
    outputTokens: 4,
    ...overrides,
  };
}

describe("db/claude-runs", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("lists runs recorded at or after the given time", () => {
    insertClaudeRun(run({ childLabel: "old" }));
    insertClaudeRun(run({ childLabel: "new" }));
    getDb().prepare("UPDATE claude_runs SET created_at = '2026-10-01T00:00:00.000Z' WHERE child_label = 'old'").run();

    const runs = listClaudeRuns("2026-10-10T00:00:00.000Z");
    expect(runs.map((r) => r.childLabel)).toEqual(["new"]);
    expect(runs[0]).toMatchObject({ stepType: "code-review", effort: "medium", costUsd: 0.5 });
  });

  it("keeps runs when their operation's log is deleted", () => {
    const db = getDb();
    db.prepare("INSERT INTO operations (id, type, workspace, status, started_at) VALUES ('op-1', 'autonomous', 'ws-1', 'completed', '2026-10-20T00:00:00Z')").run();
    insertClaudeRun(run());
    db.prepare("DELETE FROM operations WHERE id = 'op-1'").run();

    expect(listClaudeRuns("1970-01-01T00:00:00.000Z")).toHaveLength(1);
  });
});

describe("claude_runs backfill migration", () => {
  it("records the costed results already in operation_events, without step type or effort", () => {
    const db = new Database(":memory:");
    // Bring the schema to the version before claude_runs existed.
    runMigrations(db);
    db.exec("DROP TABLE claude_runs; DELETE FROM schema_migrations WHERE version = (SELECT MAX(version) FROM schema_migrations);");

    db.prepare("INSERT INTO operations (id, type, workspace, status, started_at) VALUES ('op-1', 'review', 'ws-1', 'completed', '2026-10-20T00:00:00Z')").run();
    const insertEvent = db.prepare("INSERT INTO operation_events (operation_id, type, data, timestamp, child_label, phase_label) VALUES ('op-1', ?, ?, ?, ?, ?)");
    insertEvent.run("output", JSON.stringify({
      type: "result",
      total_cost_usd: 0.25,
      duration_ms: 500,
      num_turns: 2,
      modelUsage: { "claude-sonnet-5-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.25 } },
    }), "2026-10-20T00:05:00Z", "verify-todo-repo", "Phase 2: verify");
    insertEvent.run("output", JSON.stringify({ type: "assistant", message: { content: [] } }), "2026-10-20T00:04:00Z", "verify-todo-repo", "Phase 2: verify");

    runMigrations(db);

    const rows = db.query("SELECT * FROM claude_runs").all();
    expect(rows).toEqual([expect.objectContaining({
      operation_id: "op-1",
      operation_type: "review",
      workspace: "ws-1",
      phase_label: "Phase 2: verify",
      child_label: "verify-todo-repo",
      step_type: null,
      effort: null,
      model: "claude-sonnet-5-5",
      cost_usd: 0.25,
      created_at: "2026-10-20T00:05:00Z",
    })]);
  });
});
