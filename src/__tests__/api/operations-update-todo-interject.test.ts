// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Operation } from "@/types/operation";

const mockKillOperation = vi.fn();
const mockWhenOperationFinished = vi.fn();
const mockStartOperationPipeline = vi.fn();
const mockFindRunningOpByWorkspace = vi.fn();
const mockSubscribeToOperation = vi.fn();
const interjectsInFlight = new Set<string>();
class ConcurrencyLimitError extends Error {
  constructor(n: number) { super(`limit ${n}`); }
}

vi.mock("@/lib/pipeline-manager", () => ({
  killOperation: (...a: unknown[]) => mockKillOperation(...a),
  whenOperationFinished: (...a: unknown[]) => mockWhenOperationFinished(...a),
  startOperationPipeline: (...a: unknown[]) => mockStartOperationPipeline(...a),
  findRunningOpByWorkspace: (...a: unknown[]) => mockFindRunningOpByWorkspace(...a),
  subscribeToOperation: (...a: unknown[]) => mockSubscribeToOperation(...a),
  interjectsInFlight,
  ConcurrencyLimitError,
}));

vi.mock("@/lib/config", () => ({
  resolveWorkspaceName: (name: string) => name,
  getOperationConfig: () => ({ bestOfN: 0 }),
  getConfig: () => ({ operations: { defaultInteractionLevel: "mid" } }),
  getWorkspaceDir: () => "/ws",
}));

const mockBuildUpdateTodoPipeline = vi.fn(async () => [{ kind: "single" }]);
const mockBuildAutonomousPipeline = vi.fn(() => [{ kind: "single" }]);

vi.mock("@/lib/pipelines/update-todo", () => ({
  buildUpdateTodoPipeline: (...a: unknown[]) => mockBuildUpdateTodoPipeline(...a),
}));

vi.mock("@/lib/pipelines/autonomous", () => ({
  buildAutonomousPipeline: (...a: unknown[]) => mockBuildAutonomousPipeline(...a),
}));

function makeManaged(type: string, id = "running-op", workspace = "ws-a", inputs: Record<string, string> = {}) {
  return {
    operation: {
      id,
      type,
      workspace,
      status: "running",
      startedAt: new Date().toISOString(),
      children: [],
      inputs,
    } as unknown as Operation,
  };
}

function makeOpResponse(id = "new-op", workspace = "ws-a"): Operation {
  return {
    id,
    type: "update-todo",
    workspace,
    status: "running",
    startedAt: new Date().toISOString(),
    children: [],
  };
}

async function postUpdateTodo(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/operations/update-todo/route");
  const request = new Request("http://localhost:3741/api/operations/update-todo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockKillOperation.mockReset();
  mockWhenOperationFinished.mockReset().mockResolvedValue(undefined);
  mockStartOperationPipeline.mockReset();
  mockFindRunningOpByWorkspace.mockReset();
  mockSubscribeToOperation.mockReset();
  mockBuildUpdateTodoPipeline.mockClear();
  mockBuildAutonomousPipeline.mockClear();
  interjectsInFlight.clear();

  mockStartOperationPipeline.mockReturnValue(makeOpResponse());
});

describe("POST /api/operations/update-todo (interject)", () => {
  it("interject=true with running autonomous: kills, awaits, starts update-todo, then re-kicks autonomous on complete", async () => {
    const running = makeManaged("autonomous", "auto-1", "ws-a", {
      description: "do thing",
      maxLoops: "3",
      draft: "false",
    });
    mockFindRunningOpByWorkspace.mockReturnValue(running);

    let capturedListener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id: string, listener) => {
      capturedListener = listener;
      return () => {};
    });

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockFindRunningOpByWorkspace).toHaveBeenCalledWith("ws-a");
    expect(mockKillOperation).toHaveBeenCalledWith("auto-1");
    expect(mockWhenOperationFinished).toHaveBeenCalledWith("auto-1");
    expect(mockBuildUpdateTodoPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ interject: true }),
    );
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToOperation).toHaveBeenCalledTimes(1);

    capturedListener!({ type: "complete", data: JSON.stringify({ exitCode: 0 }) });
    await flushPromises();

    expect(mockBuildAutonomousPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        startWith: "execute",
        workspace: "ws-a",
        description: "do thing",
        maxLoops: 3,
      }),
    );
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(2);
    expect(mockStartOperationPipeline.mock.calls[1][0]).toBe("autonomous");
  });

  it("interject=true with non-autonomous running op: kills + runs update-todo but does NOT re-kick", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue(makeManaged("execute", "exe-1", "ws-a"));

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockKillOperation).toHaveBeenCalledWith("exe-1");
    expect(mockWhenOperationFinished).toHaveBeenCalled();
    expect(mockSubscribeToOperation).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
  });

  it("interject=true with no running op: just starts update-todo, no kill, no re-kick", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue(undefined);

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockKillOperation).not.toHaveBeenCalled();
    expect(mockWhenOperationFinished).not.toHaveBeenCalled();
    expect(mockSubscribeToOperation).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when an interject is already in flight for the same workspace", async () => {
    interjectsInFlight.add("ws-a");

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(409);
    expect(mockStartOperationPipeline).not.toHaveBeenCalled();
  });

  it("re-kick failure surfaces via console.error and update-todo response stays 200", async () => {
    const running = makeManaged("autonomous", "auto-1", "ws-a", { description: "do thing" });
    mockFindRunningOpByWorkspace.mockReturnValue(running);

    let capturedListener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, listener) => {
      capturedListener = listener;
      return () => {};
    });

    mockStartOperationPipeline
      .mockReturnValueOnce(makeOpResponse())
      .mockImplementationOnce(() => {
        throw new ConcurrencyLimitError(3);
      });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    capturedListener!({ type: "complete", data: JSON.stringify({ exitCode: 0 }) });
    await flushPromises();

    expect(errSpy).toHaveBeenCalled();
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toMatch(/re-kick|rekick|autonomous/i);

    errSpy.mockRestore();
  });

  it("interject=false preserves existing behavior (no kill lookup, no re-kick)", async () => {
    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
    });
    expect(response.status).toBe(200);

    expect(mockFindRunningOpByWorkspace).not.toHaveBeenCalled();
    expect(mockKillOperation).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
    expect(mockBuildUpdateTodoPipeline).toHaveBeenCalledWith(
      expect.not.objectContaining({ interject: true }),
    );
  });

  it("interjectsInFlight is cleared even when buildUpdateTodoPipeline throws", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue(undefined);
    mockBuildUpdateTodoPipeline.mockRejectedValueOnce(new Error("boom"));

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(500);
    expect(interjectsInFlight.has("ws-a")).toBe(false);
  });

  it("re-kick does not fire if update-todo completes with non-zero exit code", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue(makeManaged("autonomous"));

    let capturedListener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, listener) => {
      capturedListener = listener;
      return () => {};
    });

    await postUpdateTodo({ workspace: "ws-a", instruction: "x", interject: true });

    capturedListener!({ type: "complete", data: JSON.stringify({ exitCode: 1 }) });
    await flushPromises();

    expect(mockBuildAutonomousPipeline).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
  });
});
