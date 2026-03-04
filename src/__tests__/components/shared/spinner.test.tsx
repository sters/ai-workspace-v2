import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/shared/feedback/spinner";

describe("Spinner", () => {
  it("renders a span element", () => {
    const { container } = render(<Spinner />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe("SPAN");
  });

  it("applies spinning animation class", () => {
    const { container } = render(<Spinner />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("animate-spin");
  });

  it("applies border styling for spinner appearance", () => {
    const { container } = render(<Spinner />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("border-2");
    expect(el.className).toContain("border-current");
    expect(el.className).toContain("border-t-transparent");
  });

  it("merges additional className", () => {
    const { container } = render(<Spinner className="h-5 w-5" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("animate-spin");
    expect(el.className).toContain("rounded-full");
  });
});
