import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

const listAllWorkspacesWithAge = vi.fn();
const deleteWorkspace = vi.fn();
const getArchivedNameSet = vi.fn();

vi.mock("@/lib/workspace", () => ({
  listAllWorkspacesWithAge: (days: number) => listAllWorkspacesWithAge(days),
  deleteWorkspace: (name: string) => deleteWorkspace(name),
}));
vi.mock("@/lib/db", () => ({
  getArchivedNameSet: () => getArchivedNameSet(),
}));

const { buildWorkspacePrunePipeline } = await import("@/lib/pipelines/workspace-prune");

function workspace(name: string, ageDays: number, isStale: boolean) {
  return { name, ageDays, isStale, lastModified: new Date("2026-09-01T00:00:00Z") };
}

function fakeContext(answer = "Delete all") {
  const asked: string[] = [];
  const ctx = {
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async (questions: { question: string }[]) => {
      asked.push(...questions.map((q) => q.question));
      return { q: answer };
    }),
    signal: new AbortController().signal,
  } as unknown as PhaseFunctionContext;
  return { ctx, asked };
}

async function run(options: { days: number; archivedOnly: boolean }, ctx: PhaseFunctionContext) {
  const [phase] = buildWorkspacePrunePipeline(options);
  if (phase.kind !== "function") throw new Error("expected a function phase");
  return phase.fn(ctx);
}

beforeEach(() => {
  listAllWorkspacesWithAge.mockReset();
  deleteWorkspace.mockReset();
  getArchivedNameSet.mockReset();
  listAllWorkspacesWithAge.mockReturnValue([
    workspace("old-archived", 30, true),
    workspace("old-active", 30, true),
    workspace("new-archived", 1, false),
  ]);
  getArchivedNameSet.mockReturnValue(new Set(["old-archived", "new-archived"]));
});

describe("buildWorkspacePrunePipeline", () => {
  it("deletes only stale workspaces that are archived when archivedOnly is set", async () => {
    const { ctx, asked } = fakeContext();
    await run({ days: 7, archivedOnly: true }, ctx);

    expect(deleteWorkspace.mock.calls).toEqual([["old-archived"]]);
    expect(asked[0]).toContain("old-archived");
    expect(asked[0]).not.toContain("old-active");
  });

  it("deletes every stale workspace when archivedOnly is off", async () => {
    const { ctx } = fakeContext();
    await run({ days: 7, archivedOnly: false }, ctx);

    expect(deleteWorkspace.mock.calls).toEqual([["old-archived"], ["old-active"]]);
  });

  it("does not ask when nothing stale is archived", async () => {
    getArchivedNameSet.mockReturnValue(new Set(["new-archived"]));
    const { ctx } = fakeContext();
    await run({ days: 7, archivedOnly: true }, ctx);

    expect(ctx.emitAsk).not.toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });
});
