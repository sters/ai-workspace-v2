import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/shared/progress-bar";

describe("ProgressBar", () => {
  it("displays the percentage label by default", () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("hides the label when showLabel is false", () => {
    render(<ProgressBar value={50} showLabel={false} />);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });

  it("displays 0% correctly", () => {
    render(<ProgressBar value={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("displays 100% correctly", () => {
    render(<ProgressBar value={100} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("sets the inner bar width via style", () => {
    const { container } = render(<ProgressBar value={75} />);
    const innerBar = container.querySelector("[style]");
    expect(innerBar).not.toBeNull();
    expect(innerBar!.getAttribute("style")).toContain("width: 75%");
  });

  it("applies green color for 100%", () => {
    const { container } = render(<ProgressBar value={100} />);
    const innerBar = container.querySelector("[style]");
    expect(innerBar!.className).toContain("bg-green-500");
  });

  it("applies blue color for 50-99%", () => {
    const { container } = render(<ProgressBar value={50} />);
    const innerBar = container.querySelector("[style]");
    expect(innerBar!.className).toContain("bg-blue-500");
  });

  it("applies amber color for values below 50%", () => {
    const { container } = render(<ProgressBar value={25} />);
    const innerBar = container.querySelector("[style]");
    expect(innerBar!.className).toContain("bg-amber-500");
  });

  it("applies additional className to outer container", () => {
    const { container } = render(
      <ProgressBar value={50} className="mt-4" />
    );
    const outer = container.firstElementChild!;
    expect(outer.className).toContain("mt-4");
  });
});
