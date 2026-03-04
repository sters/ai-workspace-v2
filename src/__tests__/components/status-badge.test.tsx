import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/shared/feedback/status-badge";

describe("StatusBadge", () => {
  it("renders the label text", () => {
    render(<StatusBadge label="feature" />);
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("renders as a span element", () => {
    render(<StatusBadge label="bugfix" />);
    const el = screen.getByText("bugfix");
    expect(el.tagName).toBe("SPAN");
  });

  it("applies base styling classes", () => {
    render(<StatusBadge label="test" />);
    const el = screen.getByText("test");
    expect(el.className).toContain("inline-flex");
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("text-xs");
    expect(el.className).toContain("font-medium");
  });

  it("applies feature variant styling when label is 'feature'", () => {
    render(<StatusBadge label="feature" />);
    const el = screen.getByText("feature");
    expect(el.className).toContain("bg-blue-100");
    expect(el.className).toContain("text-blue-800");
  });

  it("applies bugfix variant styling", () => {
    render(<StatusBadge label="bugfix" />);
    const el = screen.getByText("bugfix");
    expect(el.className).toContain("bg-red-100");
    expect(el.className).toContain("text-red-800");
  });

  it("applies completed variant styling", () => {
    render(<StatusBadge label="completed" />);
    const el = screen.getByText("completed");
    expect(el.className).toContain("bg-green-100");
  });

  it("applies running variant styling", () => {
    render(<StatusBadge label="running" />);
    const el = screen.getByText("running");
    expect(el.className).toContain("bg-yellow-100");
  });

  it("uses explicit variant over label for styling", () => {
    render(<StatusBadge label="My Status" variant="feature" />);
    const el = screen.getByText("My Status");
    expect(el.className).toContain("bg-blue-100");
  });

  it("falls back to unknown variant for unrecognized labels", () => {
    render(<StatusBadge label="something-else" />);
    const el = screen.getByText("something-else");
    expect(el.className).toContain("bg-gray-100");
    expect(el.className).toContain("text-gray-800");
  });

  it("applies additional className", () => {
    render(<StatusBadge label="test" className="ml-2" />);
    const el = screen.getByText("test");
    expect(el.className).toContain("ml-2");
  });
});
