// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { listActiveSuggestions } from "@/lib/db/suggestions";

// Mock runClaude
const mockOnEvent = vi.fn();
const mockGetResultText = vi.fn();
const mockKill = vi.fn();
const mockSubmitAnswer = vi.fn();

vi.mock("@/lib/claude", () => ({
  runClaude: vi.fn(() => ({
    id: "mock-id",
    onEvent: mockOnEvent,
    kill: mockKill,
    submitAnswer: mockSubmitAnswer,
    getResultText: mockGetResultText,
  })),
}));

// Mock workspace reader
vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn().mockResolvedValue("# Test\n\nScope: fix auth"),
  getTodos: vi.fn().mockResolvedValue([]),
  getReviewSessions: vi.fn().mockResolvedValue([]),
  getReviewDetail: vi.fn().mockResolvedValue(null),
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

    // Import after mocks are set up
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

  it("handles empty suggestions gracefully", async () => {
    const resultJson = JSON.stringify({ suggestions: [] });

    mockGetResultText.mockReturnValue(resultJson);
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
