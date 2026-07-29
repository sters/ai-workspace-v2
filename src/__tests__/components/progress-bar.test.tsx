import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/shared/feedback/progress-bar";

const innerBarClass = (value: number) => {
  const { container } = render(<ProgressBar value={value} />);
  return container.querySelector("[style]")!.className;
};

describe("ProgressBar", () => {
  it("displays the percentage label by default", () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("hides the label when showLabel is false", () => {
    render(<ProgressBar value={50} showLabel={false} />);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("sets the inner bar width via style", () => {
    const { container } = render(<ProgressBar value={75} />);
    const innerBar = container.querySelector("[style]");
    expect(innerBar).not.toBeNull();
    expect(innerBar!.getAttribute("style")).toContain("width: 75%");
  });

  // Only the two thresholds are worth pinning: complete-vs-not, and the >= 50 edge.
  it("switches colour at 100 and at the 50 boundary", () => {
    expect(innerBarClass(100)).toContain("bg-green-500");
    expect(innerBarClass(99)).toContain("bg-blue-500");
    expect(innerBarClass(50)).toContain("bg-blue-500");
    expect(innerBarClass(49)).toContain("bg-amber-500");
  });
});
