import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheckAuthStatus = vi.fn();
const mockSpawnClaudeAuth = vi.fn();
const mockStartOperationPipeline = vi.fn();

vi.mock("@/lib/claude/login", () => ({
  checkAuthStatus: (...args: unknown[]) => mockCheckAuthStatus(...args),
  spawnClaudeAuth: (...args: unknown[]) => mockSpawnClaudeAuth(...args),
}));

vi.mock("@/lib/pipeline-manager", () => ({
  startOperationPipeline: (...args: unknown[]) =>
    mockStartOperationPipeline(...args),
}));

import { POST } from "@/app/api/operations/claude-login/route";

describe("POST /api/operations/claude-login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartOperationPipeline.mockReturnValue({
      id: "op-1",
      type: "claude-login",
      workspace: "claude-login",
      status: "running",
      startedAt: new Date().toISOString(),
    });
  });

  it("starts a claude-login operation pipeline", async () => {
    const response = await POST();
    const body = await response.json();

    expect(body.id).toBe("op-1");
    expect(body.type).toBe("claude-login");
    expect(mockStartOperationPipeline).toHaveBeenCalledWith(
      "claude-login",
      "claude-login",
      expect.arrayContaining([
        expect.objectContaining({
          kind: "function",
          label: "Claude Login",
        }),
      ]),
    );
  });

  it("passes a function phase that calls checkAuthStatus and spawnClaudeAuth", async () => {
    await POST();

    const phases = mockStartOperationPipeline.mock.calls[0][2];
    const fnPhase = phases[0];

    // Mock checkAuthStatus to return a status string
    mockCheckAuthStatus.mockResolvedValueOnce("Authenticated");

    // Mock spawnClaudeAuth to return a completed login process
    const encoder = new TextEncoder();
    mockSpawnClaudeAuth.mockReturnValueOnce({
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("Login successful"));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) { controller.close(); },
      }),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });

    const mockCtx = {
      emitStatus: vi.fn(),
      signal: new AbortController().signal,
    };

    const result = await fnPhase.fn(mockCtx);

    expect(result).toBe(true);
    expect(mockCheckAuthStatus).toHaveBeenCalled();
    expect(mockSpawnClaudeAuth).toHaveBeenCalledWith("login");
    expect(mockCtx.emitStatus).toHaveBeenCalledWith("Login completed successfully!");
  });
});
