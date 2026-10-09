// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Operation } from "@/types/operation";

const mockStartOperationPipeline = vi.fn();
const mockAcquireInterject = vi.fn();
const mockReleaseInterject = vi.fn();
const mockKillAndAwait = vi.fn();
const mockScheduleAutonomousRekick = vi.fn();
class ConcurrencyLimitError extends Error {
  constructor(n: number) { super(`limit ${n}`); }
}

vi.mock("@/lib/pipeline-manager", () => ({
  startOperationPipeline: (...a: unknown[]) => mockStartOperationPipeline(...a),
  ConcurrencyLimitError,
}));

vi.mock("@/lib/pipeline/interject", () => ({
  acquireInterject: (...a: unknown[]) => mockAcquireInterject(...a),
  releaseInterject: (...a: unknown[]) => mockReleaseInterject(...a),
  killAndAwait: (...a: unknown[]) => mockKillAndAwait(...a),
  scheduleAutonomousRekick: (...a: unknown[]) => mockScheduleAutonomousRekick(...a),
}));

vi.mock("@/lib/config", () => ({
  resolveWorkspaceName: (name: string) => name,
  getConfig: () => ({ operations: { defaultInteractionLevel: "mid" } }),
  getWorkspaceDir: () => "/ws",
}));

const mockBuildUpdateTodoPipeline = vi.fn(async () => [{ kind: "single" }]);

vi.mock("@/lib/pipelines/update-todo", () => ({
  buildUpdateTodoPipeline: (...a: unknown[]) => mockBuildUpdateTodoPipeline(...a),
}));

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

beforeEach(() => {
  mockStartOperationPipeline.mockReset().mockReturnValue(makeOpResponse());
  mockAcquireInterject.mockReset().mockReturnValue(true);
  mockReleaseInterject.mockReset();
  mockKillAndAwait.mockReset().mockResolvedValue({ wasAutonomous: false });
  mockScheduleAutonomousRekick.mockReset();
  mockBuildUpdateTodoPipeline.mockClear();
});

describe("POST /api/operations/update-todo (interject)", () => {
  it("interject=true with running autonomous: kills, awaits, starts update-todo, schedules re-kick", async () => {
    mockKillAndAwait.mockResolvedValue({
      wasAutonomous: true,
      autonomousInputs: { description: "task", maxLoops: "3" },
    });

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockAcquireInterject).toHaveBeenCalledWith("ws-a");
    expect(mockKillAndAwait).toHaveBeenCalledWith("ws-a");
    expect(mockBuildUpdateTodoPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ interject: true }),
    );
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
    expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith(
      "new-op",
      "ws-a",
      { description: "task", maxLoops: "3" },
    );
    expect(mockReleaseInterject).toHaveBeenCalledWith("ws-a");
  });

  it("interject=true with non-autonomous running op: no re-kick scheduled", async () => {
    mockKillAndAwait.mockResolvedValue({ wasAutonomous: false });

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockKillAndAwait).toHaveBeenCalled();
    expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
  });

  it("returns 409 when acquireInterject returns false", async () => {
    mockAcquireInterject.mockReturnValue(false);

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(409);
    expect(mockKillAndAwait).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).not.toHaveBeenCalled();
    expect(mockReleaseInterject).not.toHaveBeenCalled();
  });

  it("interject=false preserves existing behavior (no interject helpers called)", async () => {
    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
    });
    expect(response.status).toBe(200);

    expect(mockAcquireInterject).not.toHaveBeenCalled();
    expect(mockKillAndAwait).not.toHaveBeenCalled();
    expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledTimes(1);
    expect(mockBuildUpdateTodoPipeline).toHaveBeenCalledWith(
      expect.not.objectContaining({ interject: true }),
    );
  });

  it("releaseInterject is called even when buildUpdateTodoPipeline throws", async () => {
    mockBuildUpdateTodoPipeline.mockRejectedValueOnce(new Error("boom"));

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(500);
    expect(mockReleaseInterject).toHaveBeenCalledWith("ws-a");
  });

  it("returns 429 on ConcurrencyLimitError and still releases the interject", async () => {
    mockStartOperationPipeline.mockImplementationOnce(() => {
      throw new ConcurrencyLimitError(3);
    });

    const response = await postUpdateTodo({
      workspace: "ws-a",
      instruction: "refresh",
      interject: true,
    });
    expect(response.status).toBe(429);
    expect(mockReleaseInterject).toHaveBeenCalledWith("ws-a");
  });
});
