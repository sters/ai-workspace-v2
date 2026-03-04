import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultBox } from "@/components/shared/feedback/result-box";

vi.mock("@/components/shared/content/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

describe("ResultBox", () => {
  it("renders content via MarkdownRenderer", () => {
    render(<ResultBox content="Hello world" />);
    expect(screen.getByTestId("markdown-renderer")).toHaveTextContent(
      "Hello world"
    );
  });

  it("applies green result styling", () => {
    const { container } = render(<ResultBox content="test" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-green-50");
    expect(el.className).toContain("text-green-800");
  });

  it("shows cost when provided", () => {
    render(<ResultBox content="test" cost="$0.05" />);
    expect(screen.getByText("$0.05")).toBeInTheDocument();
  });

  it("shows duration when provided", () => {
    render(<ResultBox content="test" duration="12s" />);
    expect(screen.getByText("12s")).toBeInTheDocument();
  });

  it("shows cost and duration separated by pipe", () => {
    render(<ResultBox content="test" cost="$0.05" duration="12s" />);
    expect(screen.getByText("$0.05 | 12s")).toBeInTheDocument();
  });

  it("does not render metadata div when neither cost nor duration provided", () => {
    const { container } = render(<ResultBox content="test" />);
    expect(container.querySelector(".opacity-70")).toBeNull();
  });
});
