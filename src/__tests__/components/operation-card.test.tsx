import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationCard } from "@/components/workspace/operation-card";
import type {
  OperationEvent,
  OperationListItem,
  OperationResultSummary,
} from "@/types/operation";

let sseEvents: OperationEvent[] = [];
vi.mock("@/hooks/use-sse", () => ({
  useSSE: () => ({ events: sseEvents, connected: false }),
}));

function resultEvent(content: string, childLabel: string): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    timestamp: "2026-09-23T00:00:00.000Z",
    data: JSON.stringify({ type: "result", subtype: "success", result: content }),
    childLabel,
    phaseIndex: 3,
  };
}

function renderCard(
  resultSummary: OperationResultSummary,
  events: OperationEvent[] = [],
) {
  sseEvents = events;
  const operation: OperationListItem = {
    id: "op-1",
    type: "create-pr",
    workspace: "ws",
    status: "completed",
    startedAt: "2026-09-23T00:00:00.000Z",
    completedAt: "2026-09-23T00:05:00.000Z",
    resultSummary,
  };
  render(
    <OperationCard
      operation={operation}
      onStartOperation={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("OperationCard results", () => {
  it("shows every repository's result, labelled", () => {
    renderCard({
      content: "opened PR for repo-b",
      results: [
        { label: "repo-a", content: "opened PR for repo-a" },
        { label: "repo-b", content: "opened PR for repo-b" },
      ],
    });

    expect(screen.getByText("opened PR for repo-a")).toBeInTheDocument();
    expect(screen.getByText("opened PR for repo-b")).toBeInTheDocument();
    expect(screen.getByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
  });

  // An operation recorded before per-child results existed stored only the
  // headline; the loaded stream still has every child's.
  it("prefers the event stream over a headline-only summary", () => {
    renderCard({ content: "opened PR for repo-b" }, [
      resultEvent("opened PR for repo-a", "repo-a"),
      resultEvent("opened PR for repo-b", "repo-b"),
    ]);

    expect(screen.getByText("opened PR for repo-a")).toBeInTheDocument();
    expect(screen.getByText("opened PR for repo-b")).toBeInTheDocument();
  });

  it("falls back to the summary when no events are loaded", () => {
    renderCard({ content: "collected the reviews" });

    expect(screen.getByText("collected the reviews")).toBeInTheDocument();
  });
});
