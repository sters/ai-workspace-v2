import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/shared/feedback/status-badge";

// The palette itself is not asserted — a single class token per case is only a
// handle on which variant was selected.
describe("StatusBadge", () => {
  it("renders the label text", () => {
    render(<StatusBadge label="feature" />);
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("derives the variant from the label, case-insensitively", () => {
    render(<StatusBadge label="Completed" />);
    expect(screen.getByText("Completed").className).toContain("bg-green-100");
  });

  it("prefers an explicit variant over the label", () => {
    render(<StatusBadge label="My Status" variant="feature" />);
    expect(screen.getByText("My Status").className).toContain("bg-blue-100");
  });

  it("falls back to the unknown variant for unrecognized labels", () => {
    render(<StatusBadge label="something-else" />);
    expect(screen.getByText("something-else").className).toContain(
      "bg-gray-100"
    );
  });

  it("uses pill shape by default and drops the pill radius when square", () => {
    const { unmount } = render(<StatusBadge label="pill" />);
    expect(screen.getByText("pill").className).toContain("rounded-full");
    unmount();

    render(<StatusBadge label="project" shape="square" />);
    expect(screen.getByText("project").className).not.toContain("rounded-full");
  });

  it("renders title attribute when provided", () => {
    render(<StatusBadge label="Error" title="Connection timed out" />);
    expect(screen.getByText("Error")).toHaveAttribute(
      "title",
      "Connection timed out"
    );
  });
});
