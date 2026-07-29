import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TodoItemRow } from "@/components/workspace/todo-item";
import type { TodoItem } from "@/types/workspace";

// Mock the MarkdownRenderer since it has heavy dependencies (react-markdown)
vi.mock("@/components/shared/content/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

describe("TodoItemRow", () => {
  const makeItem = (overrides: Partial<TodoItem> = {}): TodoItem => ({
    text: "Test task",
    status: "pending",
    indent: 0,
    children: [],
    ...overrides,
  });

  it("renders the item text", () => {
    render(<TodoItemRow item={makeItem({ text: "Write unit tests" })} />);
    expect(screen.getByText("Write unit tests")).toBeInTheDocument();
  });

  it.each([
    ["completed", "✅"],
    ["pending", "⬜"],
    ["blocked", "⛔"],
    ["in_progress", "⏳"],
  ] as const)("renders the %s status icon", (status, icon) => {
    render(<TodoItemRow item={makeItem({ status })} />);
    expect(screen.getByText(icon)).toBeInTheDocument();
  });

  it("does not render children section when children is empty", () => {
    render(<TodoItemRow item={makeItem({ children: [] })} />);
    expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
  });

  it("renders children via MarkdownRenderer when present", () => {
    render(
      <TodoItemRow
        item={makeItem({
          children: ["Detail line 1", "Detail line 2"],
        })}
      />
    );
    const renderer = screen.getByTestId("markdown-renderer");
    expect(renderer).toBeInTheDocument();
    expect(renderer.textContent).toBe("Detail line 1\nDetail line 2");
  });

  it("applies indent via paddingLeft style", () => {
    const { container } = render(
      <TodoItemRow item={makeItem({ indent: 4 })} />
    );
    const styledDiv = container.querySelector("[style]");
    expect(styledDiv).not.toBeNull();
    // indent * 0.75 + 0.5 = 4 * 0.75 + 0.5 = 3.5rem
    expect(styledDiv!.getAttribute("style")).toContain("padding-left: 3.5rem");
  });
});
