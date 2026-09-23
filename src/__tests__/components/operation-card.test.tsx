import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationCard } from "@/components/workspace/operation-card";
import type { OperationListItem, OperationResultSummary } from "@/types/operation";

vi.mock("@/hooks/use-sse", () => ({
  useSSE: () => ({ events: [], connected: false }),
}));

function renderCard(resultSummary: OperationResultSummary) {
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

  // Operations recorded before per-child results existed carry only `content`.
  it("falls back to the headline result when there is no per-child list", () => {
    renderCard({ content: "collected the reviews" });

    expect(screen.getByText("collected the reviews")).toBeInTheDocument();
  });
});
