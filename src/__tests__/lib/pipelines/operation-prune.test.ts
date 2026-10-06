import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

const listAllOperationLogsWithAge = vi.fn();
const deleteStoredOperation = vi.fn();
const getArchivedNameSet = vi.fn();

vi.mock("@/lib/operation-store", () => ({
  listAllOperationLogsWithAge: (days: number) => listAllOperationLogsWithAge(days),
  deleteStoredOperation: (id: string, ws: string) => deleteStoredOperation(id, ws),
}));
vi.mock("@/lib/db", () => ({
  getArchivedNameSet: () => getArchivedNameSet(),
}));

const { buildOperationPrunePipeline } = await import("@/lib/pipelines/operation-prune");

function log(operationId: string, workspace: string, isStale: boolean) {
  return { operationId, workspace, type: "execute", startedAt: "2026-09-01T00:00:00Z", ageDays: isStale ? 30 : 1, isStale };
}

function fakeContext() {
  return {
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async () => ({ q: "Delete all" })),
    signal: new AbortController().signal,
  } as unknown as PhaseFunctionContext;
}

async function run(options: { days: number; archivedOnly: boolean }) {
  const [phase] = buildOperationPrunePipeline(options);
  if (phase.kind !== "function") throw new Error("expected a function phase");
  return phase.fn(fakeContext());
}

beforeEach(() => {
  listAllOperationLogsWithAge.mockReset();
  deleteStoredOperation.mockReset();
  getArchivedNameSet.mockReset();
  listAllOperationLogsWithAge.mockReturnValue([
    log("op-1", "archived-ws", true),
    log("op-2", "active-ws", true),
    log("op-3", "archived-ws", false),
  ]);
  getArchivedNameSet.mockReturnValue(new Set(["archived-ws"]));
});

describe("buildOperationPrunePipeline", () => {
  it("deletes only stale logs of archived workspaces when archivedOnly is set", async () => {
    await run({ days: 7, archivedOnly: true });
    expect(deleteStoredOperation.mock.calls).toEqual([["op-1", "archived-ws"]]);
  });

  it("deletes every stale log when archivedOnly is off", async () => {
    await run({ days: 7, archivedOnly: false });
    expect(deleteStoredOperation.mock.calls).toEqual([
      ["op-1", "archived-ws"],
      ["op-2", "active-ws"],
    ]);
  });
});
