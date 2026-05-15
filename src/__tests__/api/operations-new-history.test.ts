// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Operation, OperationListItem } from "@/types/operation";
import { getDb, _resetDb, _setDbPath, insertOperation, updateOperationStatus } from "@/lib/db";

const mockGetOperationSummaries = vi.fn<() => OperationListItem[]>();

vi.mock("@/lib/pipeline-manager", () => ({
  getOperationSummaries: () => mockGetOperationSummaries(),
}));

const ID = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

function makeOp(id: string, overrides: Partial<Operation> = {}): Operation {
  return {
    id,
    type: "init",
    workspace: "",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function insertCompleted(op: Operation): void {
  insertOperation(op);
  updateOperationStatus(op.id, op.status, op.completedAt);
}

async function fetchNewHistory(query: string = ""): Promise<OperationListItem[]> {
  const { GET } = await import("@/app/api/operations/new-history/route");
  const url = `http://localhost:3741/api/operations/new-history${query}`;
  const response = await GET(new Request(url));
  expect(response.ok).toBe(true);
  return (await response.json()) as OperationListItem[];
}

describe("GET /api/operations/new-history", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    mockGetOperationSummaries.mockReset();
    mockGetOperationSummaries.mockReturnValue([]);
  });

  it("returns empty when nothing matches", async () => {
    expect(await fetchNewHistory()).toEqual([]);
  });

  it("only includes init and autonomous-startWith-init operations", async () => {
    insertCompleted(makeOp(ID(1), { type: "init" }));
    insertCompleted(makeOp(ID(2), { type: "execute" }));
    insertCompleted(
      makeOp(ID(3), { type: "autonomous", inputs: { startWith: "init" } }),
    );
    insertCompleted(
      makeOp(ID(4), { type: "autonomous", inputs: { startWith: "execute" } }),
    );

    const result = await fetchNewHistory();
    const ids = result.map((op) => op.id).sort();
    expect(ids).toEqual([ID(1), ID(3)].sort());
  });

  it("respects limit query parameter", async () => {
    for (let i = 1; i <= 15; i++) {
      insertCompleted(
        makeOp(ID(i), { startedAt: new Date(2024, 0, i).toISOString() }),
      );
    }
    const result = await fetchNewHistory("?limit=5");
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe(ID(15));
  });

  it("defaults to 10 when limit is missing", async () => {
    for (let i = 1; i <= 15; i++) {
      insertCompleted(
        makeOp(ID(i), { startedAt: new Date(2024, 0, i).toISOString() }),
      );
    }
    expect(await fetchNewHistory()).toHaveLength(10);
  });

  it("clamps limit to a maximum", async () => {
    for (let i = 1; i <= 60; i++) {
      insertCompleted(
        makeOp(ID(i), { startedAt: new Date(2024, 0, i).toISOString() }),
      );
    }
    const result = await fetchNewHistory("?limit=1000");
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("places running in-memory operations first", async () => {
    insertCompleted(
      makeOp(ID(1), {
        type: "init",
        startedAt: "2024-01-10T00:00:00.000Z",
      }),
    );
    mockGetOperationSummaries.mockReturnValue([
      {
        id: ID(2),
        type: "init",
        workspace: "",
        status: "running",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ]);

    const result = await fetchNewHistory();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(ID(2));
    expect(result[0].status).toBe("running");
    expect(result[1].id).toBe(ID(1));
  });

  it("filters in-memory operations with the same new-originated rule", async () => {
    mockGetOperationSummaries.mockReturnValue([
      {
        id: ID(1),
        type: "execute",
        workspace: "ws-a",
        status: "running",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: ID(2),
        type: "autonomous",
        workspace: "",
        status: "running",
        startedAt: "2024-01-02T00:00:00.000Z",
        inputs: { startWith: "execute" },
      },
      {
        id: ID(3),
        type: "init",
        workspace: "",
        status: "running",
        startedAt: "2024-01-03T00:00:00.000Z",
      },
    ]);

    const result = await fetchNewHistory();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ID(3));
  });

  it("dedupes when an operation appears in both in-memory and DB stores", async () => {
    insertCompleted(makeOp(ID(1), { type: "init" }));
    mockGetOperationSummaries.mockReturnValue([
      {
        id: ID(1),
        type: "init",
        workspace: "ws-resolved",
        status: "completed",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ]);

    const result = await fetchNewHistory();
    expect(result).toHaveLength(1);
    // In-memory wins (workspace is the in-memory value, not the stub "").
    expect(result[0].workspace).toBe("ws-resolved");
  });
});
