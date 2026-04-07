// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { listActiveSuggestions } from "@/lib/db/suggestions";

// Mock runClaude
const mockRunClaude = vi.fn();
const mockOnEvent = vi.fn();
const mockGetResultText = vi.fn();
const mockKill = vi.fn();
const mockSubmitAnswer = vi.fn();

vi.mock("@/lib/claude", () => ({
  runClaude: (...args: unknown[]) => {
    mockRunClaude(...args);
    return {
      id: "mock-id",
      onEvent: mockOnEvent,
      kill: mockKill,
      submitAnswer: mockSubmitAnswer,
      getResultText: mockGetResultText,
    };
  },
}));

// Mock workspace reader — only getReadme is still used
vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn().mockResolvedValue("# Test\n\nScope: fix auth"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

// Mock operation store — provide an event stream the digest builder can parse.
vi.mock("@/lib/operation-store", () => ({
  readOperationLog: vi.fn(() => ({
    operation: {
      id: "op-1",
      type: "execute",
      workspace: "test-ws",
      status: "running",
      startedAt: new Date().toISOString(),
    },
    events: [
      {
        type: "output",
        operationId: "op-1",
        data: JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "I noticed the logging module has a flaky test unrelated to this TODO." },
              { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/repo/logging.ts" } },
            ],
          },
        }),
        timestamp: new Date().toISOString(),
      },
    ],
  })),
}));

// Mock event buffer flush (no-op in tests)
vi.mock("@/lib/db/event-buffer", () => ({
  flushEvents: vi.fn(),
}));

describe("triggerWorkspaceSuggestion", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts suggestions when Claude returns valid results", async () => {
    const resultJson = JSON.stringify({
      suggestions: [
        { targetRepository: "repo-a", title: "Fix logging", description: "Logging module needs cleanup" },
      ],
    });

    mockGetResultText.mockReturnValue(resultJson);
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      // Simulate immediate completion
      setTimeout(() => handler({ type: "complete" }), 10);
    });

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");

    triggerWorkspaceSuggestion("test-ws", "op-1", "execute");

    // Wait for the async fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const suggestions = listActiveSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe("Fix logging");
    expect(suggestions[0].description).toBe("Logging module needs cleanup");
    expect(suggestions[0].sourceWorkspace).toBe("test-ws");
    expect(suggestions[0].sourceOperationId).toBe("op-1");
  });

  it("passes a resolved model to runClaude (default sonnet)", async () => {
    mockGetResultText.mockReturnValue(JSON.stringify({ suggestions: [] }));
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      setTimeout(() => handler({ type: "complete" }), 10);
    });

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");
    triggerWorkspaceSuggestion("test-ws", "op-1", "execute");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockRunClaude).toHaveBeenCalled();
    const lastCall = mockRunClaude.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const options = lastCall?.[2] as { model?: string } | undefined;
    expect(options?.model).toBe("sonnet");
  });

  it("builds the prompt from the operation transcript digest", async () => {
    mockGetResultText.mockReturnValue(JSON.stringify({ suggestions: [] }));
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      setTimeout(() => handler({ type: "complete" }), 10);
    });

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");
    triggerWorkspaceSuggestion("test-ws", "op-1", "execute");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const lastCall = mockRunClaude.mock.calls.at(-1);
    const prompt = lastCall?.[1] as string | undefined;
    expect(prompt).toBeDefined();
    // Should contain content extracted from the mocked operation log
    expect(prompt).toContain("flaky test");
    // Should contain a tool-call summary (the Read target file path)
    expect(prompt).toContain("logging.ts");
  });

  it("handles empty suggestions gracefully", async () => {
    mockGetResultText.mockReturnValue(JSON.stringify({ suggestions: [] }));
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      setTimeout(() => handler({ type: "complete" }), 10);
    });

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");

    triggerWorkspaceSuggestion("test-ws", "op-1", "execute");

    await new Promise((resolve) => setTimeout(resolve, 100));

    const suggestions = listActiveSuggestions();
    expect(suggestions).toHaveLength(0);
  });

  it("does not throw on error", async () => {
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      setTimeout(() => handler({ type: "error" }), 10);
    });
    mockGetResultText.mockReturnValue(undefined);

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");

    // Should not throw
    expect(() => {
      triggerWorkspaceSuggestion("test-ws", "op-1", "execute");
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const suggestions = listActiveSuggestions();
    expect(suggestions).toHaveLength(0);
  });
});
