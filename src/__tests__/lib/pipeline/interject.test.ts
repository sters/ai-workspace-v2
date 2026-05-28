// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockKillOperation = vi.fn();
const mockWhenOperationFinished = vi.fn();
const mockStartOperationPipeline = vi.fn();
const mockFindRunningOpByWorkspace = vi.fn();
const mockSubscribeToOperation = vi.fn();
const mockBuildAutonomousPipeline = vi.fn(() => [{ kind: "single" }]);

vi.mock("@/lib/pipeline", () => ({
  killOperation: (...a: unknown[]) => mockKillOperation(...a),
  whenOperationFinished: (...a: unknown[]) => mockWhenOperationFinished(...a),
  startOperationPipeline: (...a: unknown[]) => mockStartOperationPipeline(...a),
  findRunningOpByWorkspace: (...a: unknown[]) => mockFindRunningOpByWorkspace(...a),
  subscribeToOperation: (...a: unknown[]) => mockSubscribeToOperation(...a),
}));

vi.mock("@/lib/pipelines/autonomous", () => ({
  buildAutonomousPipeline: (...a: unknown[]) => mockBuildAutonomousPipeline(...a),
}));

import {
  acquireInterject,
  releaseInterject,
  killAndAwait,
  scheduleAutonomousRekick,
} from "@/lib/pipeline/interject";
import { interjectsInFlight } from "@/lib/pipeline/store";

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockKillOperation.mockReset();
  mockWhenOperationFinished.mockReset().mockResolvedValue(undefined);
  mockStartOperationPipeline.mockReset();
  mockFindRunningOpByWorkspace.mockReset();
  mockSubscribeToOperation.mockReset();
  mockBuildAutonomousPipeline.mockClear();
  interjectsInFlight.clear();
});

describe("acquireInterject / releaseInterject", () => {
  it("returns true on first acquire and false on duplicate", () => {
    expect(acquireInterject("ws-a")).toBe(true);
    expect(acquireInterject("ws-a")).toBe(false);
  });

  it("release allows re-acquire", () => {
    acquireInterject("ws-a");
    releaseInterject("ws-a");
    expect(acquireInterject("ws-a")).toBe(true);
  });

  it("tracks workspaces independently", () => {
    acquireInterject("ws-a");
    expect(acquireInterject("ws-b")).toBe(true);
  });
});

describe("killAndAwait", () => {
  it("returns wasAutonomous=false and no inputs when nothing is running", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue(undefined);
    const result = await killAndAwait("ws-a");
    expect(result).toEqual({ wasAutonomous: false });
    expect(mockKillOperation).not.toHaveBeenCalled();
    expect(mockWhenOperationFinished).not.toHaveBeenCalled();
  });

  it("kills and awaits when something is running", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue({
      operation: { id: "op-1", type: "execute", workspace: "ws-a", status: "running" },
    });
    const result = await killAndAwait("ws-a");
    expect(mockKillOperation).toHaveBeenCalledWith("op-1");
    expect(mockWhenOperationFinished).toHaveBeenCalledWith("op-1");
    expect(result).toEqual({ wasAutonomous: false });
  });

  it("captures inputs and flags wasAutonomous when running op is autonomous", async () => {
    mockFindRunningOpByWorkspace.mockReturnValue({
      operation: {
        id: "auto-1",
        type: "autonomous",
        workspace: "ws-a",
        status: "running",
        inputs: { description: "task", maxLoops: "3" },
      },
    });
    const result = await killAndAwait("ws-a");
    expect(result.wasAutonomous).toBe(true);
    expect(result.autonomousInputs).toEqual({ description: "task", maxLoops: "3" });
  });
});

describe("scheduleAutonomousRekick", () => {
  it("re-kicks autonomous when source op completes with exitCode=0", async () => {
    let listener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, l) => {
      listener = l;
      return () => {};
    });

    scheduleAutonomousRekick("update-op", "ws-a", {
      description: "task",
      maxLoops: "3",
      draft: "false",
    });

    listener!({ type: "complete", data: JSON.stringify({ exitCode: 0 }) });
    await flushPromises();

    expect(mockBuildAutonomousPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        startWith: "execute",
        workspace: "ws-a",
        description: "task",
        maxLoops: 3,
      }),
    );
    expect(mockStartOperationPipeline).toHaveBeenCalledWith(
      "autonomous",
      "ws-a",
      expect.anything(),
      undefined,
      expect.objectContaining({ startWith: "execute", description: "task" }),
    );
  });

  it("does not re-kick when exitCode is non-zero", async () => {
    let listener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, l) => {
      listener = l;
      return () => {};
    });

    scheduleAutonomousRekick("update-op", "ws-a", { description: "task" });
    listener!({ type: "complete", data: JSON.stringify({ exitCode: 1 }) });
    await flushPromises();

    expect(mockBuildAutonomousPipeline).not.toHaveBeenCalled();
    expect(mockStartOperationPipeline).not.toHaveBeenCalled();
  });

  it("ignores non-complete events", async () => {
    let listener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, l) => {
      listener = l;
      return () => {};
    });

    scheduleAutonomousRekick("update-op", "ws-a", { description: "task" });
    listener!({ type: "output", data: "noise" });
    await flushPromises();

    expect(mockBuildAutonomousPipeline).not.toHaveBeenCalled();
  });

  it("surfaces re-kick failure via console.error", async () => {
    let listener: ((event: { type: string; data: string }) => void) | undefined;
    mockSubscribeToOperation.mockImplementation((_id, l) => {
      listener = l;
      return () => {};
    });
    mockStartOperationPipeline.mockImplementationOnce(() => {
      throw new Error("concurrency");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleAutonomousRekick("update-op", "ws-a", { description: "task" });
    listener!({ type: "complete", data: JSON.stringify({ exitCode: 0 }) });
    await flushPromises();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
