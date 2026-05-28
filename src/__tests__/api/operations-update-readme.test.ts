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

const mockBuildUpdateReadmePipeline = vi.fn(async () => [{ kind: "single" }]);

vi.mock("@/lib/pipelines/update-readme", () => ({
  buildUpdateReadmePipeline: (...a: unknown[]) => mockBuildUpdateReadmePipeline(...a),
}));

function makeOpResponse(id = "readme-op", workspace = "ws-a"): Operation {
  return {
    id,
    type: "update-readme",
    workspace,
    status: "running",
    startedAt: new Date().toISOString(),
    children: [],
  };
}

async function postUpdateReadme(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/operations/update-readme/route");
  const request = new Request("http://localhost:3741/api/operations/update-readme", {
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
  mockBuildUpdateReadmePipeline.mockClear();
});

describe("POST /api/operations/update-readme", () => {
  it("default (no interject): starts update-readme, no interject helpers called", async () => {
    const response = await postUpdateReadme({
      workspace: "ws-a",
      instruction: "add risks section",
    });
    expect(response.status).toBe(200);
    expect(mockAcquireInterject).not.toHaveBeenCalled();
    expect(mockKillAndAwait).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).toHaveBeenCalledWith(
      "update-readme",
      "ws-a",
      expect.anything(),
      undefined,
      expect.objectContaining({ instruction: "add risks section" }),
    );
  });

  it("validates: rejects when workspace is missing", async () => {
    const response = await postUpdateReadme({ instruction: "x" });
    expect(response.status).toBe(400);
  });

  it("validates: rejects when instruction is missing", async () => {
    const response = await postUpdateReadme({ workspace: "ws-a" });
    expect(response.status).toBe(400);
  });

  it("interject=true with running autonomous: kills, awaits, starts update-readme, schedules re-kick", async () => {
    mockKillAndAwait.mockResolvedValue({
      wasAutonomous: true,
      autonomousInputs: { description: "task" },
    });

    const response = await postUpdateReadme({
      workspace: "ws-a",
      instruction: "tighten objective",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockAcquireInterject).toHaveBeenCalledWith("ws-a");
    expect(mockKillAndAwait).toHaveBeenCalledWith("ws-a");
    expect(mockBuildUpdateReadmePipeline).toHaveBeenCalledWith(
      expect.objectContaining({ interject: true }),
    );
    expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith(
      "readme-op",
      "ws-a",
      { description: "task" },
    );
    expect(mockReleaseInterject).toHaveBeenCalledWith("ws-a");
  });

  it("interject=true with non-autonomous running op: no re-kick scheduled", async () => {
    mockKillAndAwait.mockResolvedValue({ wasAutonomous: false });

    const response = await postUpdateReadme({
      workspace: "ws-a",
      instruction: "x",
      interject: true,
    });
    expect(response.status).toBe(200);

    expect(mockKillAndAwait).toHaveBeenCalled();
    expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
  });

  it("returns 409 when acquireInterject returns false", async () => {
    mockAcquireInterject.mockReturnValue(false);

    const response = await postUpdateReadme({
      workspace: "ws-a",
      instruction: "x",
      interject: true,
    });
    expect(response.status).toBe(409);
    expect(mockKillAndAwait).not.toHaveBeenCalled();
  });

  it("releaseInterject is called even when pipeline build throws", async () => {
    mockBuildUpdateReadmePipeline.mockRejectedValueOnce(new Error("boom"));

    const response = await postUpdateReadme({
      workspace: "ws-a",
      instruction: "x",
      interject: true,
    });
    expect(response.status).toBe(500);
    expect(mockReleaseInterject).toHaveBeenCalledWith("ws-a");
  });
});
