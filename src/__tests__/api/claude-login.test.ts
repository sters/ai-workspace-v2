import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunClaudeLogin = vi.fn();
const mockStartOperationPipeline = vi.fn();

vi.mock("@/lib/claude-login", () => ({
  runClaudeLogin: (...args: unknown[]) => mockRunClaudeLogin(...args),
}));

vi.mock("@/lib/process-manager", () => ({
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

  it("passes a function phase that calls runClaudeLogin", async () => {
    await POST();

    const phases = mockStartOperationPipeline.mock.calls[0][2];
    const fnPhase = phases[0];

    const mockCtx = {
      emitStatus: vi.fn(),
      signal: new AbortController().signal,
    };
    mockRunClaudeLogin.mockResolvedValueOnce(true);

    const result = await fnPhase.fn(mockCtx);

    expect(result).toBe(true);
    expect(mockRunClaudeLogin).toHaveBeenCalledWith({
      emitStatus: mockCtx.emitStatus,
      signal: mockCtx.signal,
    });
  });
});
