// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { listActiveSuggestions } from "@/lib/db/suggestions";
import { _resetConfig, _setConfigFilePath } from "@/lib/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn().mockResolvedValue("# Test\n\nScope: fix auth"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

// An event stream the digest builder can parse.
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
    expect(prompt).toContain("flaky test");
    expect(prompt).toContain("logging.ts");
  });

  it("does nothing when suggest.enabled is false", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-disabled-"));
    const cfgPath = path.join(dir, "config.yml");
    fs.writeFileSync(cfgPath, "suggest:\n  enabled: false\n", "utf-8");
    _setConfigFilePath(cfgPath);
    _resetConfig();

    try {
      const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");
      triggerWorkspaceSuggestion("test-ws", "op-1", "execute");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRunClaude).not.toHaveBeenCalled();
      expect(listActiveSuggestions()).toHaveLength(0);
    } finally {
      _setConfigFilePath(null);
      _resetConfig();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not throw on error", async () => {
    mockOnEvent.mockImplementation((handler: (event: { type: string }) => void) => {
      setTimeout(() => handler({ type: "error" }), 10);
    });
    mockGetResultText.mockReturnValue(undefined);

    const { triggerWorkspaceSuggestion } = await import("@/lib/suggest-workspace");

    expect(() => {
      triggerWorkspaceSuggestion("test-ws", "op-1", "execute");
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const suggestions = listActiveSuggestions();
    expect(suggestions).toHaveLength(0);
  });
});
