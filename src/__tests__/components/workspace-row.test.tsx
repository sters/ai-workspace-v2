import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
import type { WorkspaceListItem } from "@/types/workspace";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function makeWorkspace(overrides: Partial<WorkspaceListItem> = {}): WorkspaceListItem {
  return {
    name: "test-workspace",
    title: "Test Title",
    taskType: "feature",
    ticketId: "TICK-123",
    date: "2025-01-15",
    repoCount: 2,
    overallProgress: 60,
    totalCompleted: 3,
    totalItems: 5,
    lastModified: "2025-01-20",
    ...overrides,
  };
}

describe("WorkspaceCard", () => {
  it("renders title", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("renders workspace name", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("test-workspace")).toBeInTheDocument();
  });

  it("renders ticket id", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("Ticket: TICK-123")).toBeInTheDocument();
  });

  it("renders category badge", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("renders progress counts", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("3/5 items")).toBeInTheDocument();
  });

  it("renders repo count", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText("2 repos")).toBeInTheDocument();
  });

  it("renders created date", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument();
  });

  it("renders updated date", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    expect(screen.getByText(/Jan 20, 2025/)).toBeInTheDocument();
  });

  it("does not render ticket when missing", () => {
    render(<WorkspaceCard workspace={makeWorkspace({ ticketId: "" })} />);
    expect(screen.queryByText(/Ticket:/)).not.toBeInTheDocument();
  });

  it("shows spinner when running", () => {
    const { container } = render(<WorkspaceCard workspace={makeWorkspace()} isRunning />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("does not show spinner when not running", () => {
    const { container } = render(<WorkspaceCard workspace={makeWorkspace()} isRunning={false} />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeNull();
  });

  it("links to workspace detail page", () => {
    render(<WorkspaceCard workspace={makeWorkspace()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/workspace/test-workspace");
  });
});
