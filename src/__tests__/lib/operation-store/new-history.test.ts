// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { listRecentNewOriginatedOperations } from "@/lib/operation-store/new-history";
import type { Operation } from "@/types/operation";
import { getDb, _resetDb, _setDbPath, insertOperation, updateOperationStatus } from "@/lib/db";

const ID = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

function makeOp(id: string, overrides: Partial<Operation> = {}): Operation {
  const op: Operation = {
    id,
    type: "init",
    workspace: "",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
  return op;
}

function insertCompleted(op: Operation): void {
  insertOperation(op);
  updateOperationStatus(op.id, op.status, op.completedAt);
}

describe("listRecentNewOriginatedOperations", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("returns empty array when no operations exist", () => {
    expect(listRecentNewOriginatedOperations(10)).toEqual([]);
  });

  it("returns init operations", () => {
    insertCompleted(makeOp(ID(1), { type: "init" }));
    insertCompleted(makeOp(ID(2), { type: "init" }));
    const result = listRecentNewOriginatedOperations(10);
    expect(result).toHaveLength(2);
    expect(result.every((op) => op.type === "init")).toBe(true);
  });

  it("includes autonomous with startWith==='init'", () => {
    insertCompleted(
      makeOp(ID(1), { type: "autonomous", inputs: { startWith: "init" } }),
    );
    const result = listRecentNewOriginatedOperations(10);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("autonomous");
  });

  it("excludes autonomous with startWith==='execute'", () => {
    insertCompleted(
      makeOp(ID(1), { type: "autonomous", inputs: { startWith: "execute" } }),
    );
    insertCompleted(
      makeOp(ID(2), { type: "autonomous", inputs: { startWith: "init" } }),
    );
    const result = listRecentNewOriginatedOperations(10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ID(2));
  });

  it("excludes autonomous with no inputs", () => {
    insertCompleted(makeOp(ID(1), { type: "autonomous" }));
    expect(listRecentNewOriginatedOperations(10)).toEqual([]);
  });

  it("excludes other operation types", () => {
    insertCompleted(makeOp(ID(1), { type: "execute" }));
    insertCompleted(makeOp(ID(2), { type: "review" }));
    insertCompleted(makeOp(ID(3), { type: "create-pr" }));
    insertCompleted(makeOp(ID(4), { type: "init" }));
    const result = listRecentNewOriginatedOperations(10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ID(4));
  });

  it("sorts by startedAt descending", () => {
    insertCompleted(makeOp(ID(1), { startedAt: "2024-01-01T00:00:00.000Z" }));
    insertCompleted(makeOp(ID(2), { startedAt: "2024-01-03T00:00:00.000Z" }));
    insertCompleted(makeOp(ID(3), { startedAt: "2024-01-02T00:00:00.000Z" }));
    const result = listRecentNewOriginatedOperations(10);
    expect(result.map((op) => op.id)).toEqual([ID(2), ID(3), ID(1)]);
  });

  it("respects limit", () => {
    for (let i = 1; i <= 15; i++) {
      insertCompleted(
        makeOp(ID(i), {
          startedAt: new Date(2024, 0, i).toISOString(),
        }),
      );
    }
    const result = listRecentNewOriginatedOperations(5);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe(ID(15));
    expect(result[4].id).toBe(ID(11));
  });

  it("returns at most limit items even when many autonomous-execute rows are sampled", () => {
    // 10 autonomous-execute (excluded) + 3 init (included)
    for (let i = 1; i <= 10; i++) {
      insertCompleted(
        makeOp(ID(i), {
          type: "autonomous",
          inputs: { startWith: "execute" },
          startedAt: new Date(2024, 0, i).toISOString(),
        }),
      );
    }
    for (let i = 11; i <= 13; i++) {
      insertCompleted(
        makeOp(ID(i), {
          type: "init",
          startedAt: new Date(2024, 0, i).toISOString(),
        }),
      );
    }
    const result = listRecentNewOriginatedOperations(10);
    expect(result).toHaveLength(3);
    expect(result.map((op) => op.id)).toEqual([ID(13), ID(12), ID(11)]);
  });
});
