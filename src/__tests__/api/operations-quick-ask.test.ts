import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClaudeModel } from "@/types/claude";

const mockRunClaude = vi.fn();
const mockGetConfig = vi.fn();

vi.mock("@/lib/claude", () => ({
  runClaude: (...args: unknown[]) => mockRunClaude(...args),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => mockGetConfig(),
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
  getWorkspaceDir: () => "/mock/workspace-root/workspace",
  resolveWorkspaceName: (name: string) => name,
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: () => "/mock/workspace-root/.claude/quick-ask.md",
}));

function setQuickAskModel(model: ClaudeModel | null) {
  mockGetConfig.mockReturnValue({ quickAsk: { model } });
}

beforeEach(() => {
  mockRunClaude.mockReset();
  mockGetConfig.mockReset();
  setQuickAskModel("sonnet");

  // Provide a stub ClaudeProcess so the route handler can subscribe
  mockRunClaude.mockReturnValue({
    id: "quick-ask",
    onEvent: (handler: (event: unknown) => void) => {
      // Immediately emit a complete event so the SSE stream closes.
      handler({
        type: "complete",
        operationId: "quick-ask",
        data: JSON.stringify({ exitCode: 0 }),
        timestamp: new Date().toISOString(),
      });
    },
    kill: () => {},
    submitAnswer: () => false,
    getResultText: () => undefined,
    onProcessSpawned: () => {},
  });
});

async function postQuickAsk() {
  const { POST } = await import("@/app/api/operations/quick-ask/route");
  const request = new Request("http://localhost:3741/api/operations/quick-ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: "demo", question: "what is this?" }),
  });
  return POST(request);
}

describe("POST /api/operations/quick-ask", () => {
  it("uses the model from quickAsk config (sonnet by default)", async () => {
    setQuickAskModel("sonnet");
    const response = await postQuickAsk();
    expect(response.status).toBe(200);

    expect(mockRunClaude).toHaveBeenCalledTimes(1);
    const [, , options] = mockRunClaude.mock.calls[0];
    expect(options).toMatchObject({ model: "sonnet" });
  });

  it("respects the quickAsk.model override from config", async () => {
    setQuickAskModel("opus");
    const response = await postQuickAsk();
    expect(response.status).toBe(200);

    const [, , options] = mockRunClaude.mock.calls[0];
    expect(options).toMatchObject({ model: "opus" });
  });

  it("passes model: undefined when quickAsk.model is null (CLI default)", async () => {
    setQuickAskModel(null);
    const response = await postQuickAsk();
    expect(response.status).toBe(200);

    const [, , options] = mockRunClaude.mock.calls[0];
    expect(options.model).toBeUndefined();
  });
});
