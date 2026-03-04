import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "@/components/shared/containers/callout";

describe("Callout", () => {
  it("renders info variant with blue border/bg", () => {
    render(
      <Callout variant="info" data-testid="callout">
        info
      </Callout>,
    );
    const el = screen.getByTestId("callout");
    expect(el.className).toContain("border-blue-200");
    expect(el.className).toContain("bg-blue-50/50");
  });

  it("renders warning variant with amber border/bg", () => {
    render(
      <Callout variant="warning" data-testid="callout">
        warning
      </Callout>,
    );
    const el = screen.getByTestId("callout");
    expect(el.className).toContain("border-amber-300");
    expect(el.className).toContain("bg-amber-50");
  });

  it("renders error variant with destructive border", () => {
    render(
      <Callout variant="error" data-testid="callout">
        error
      </Callout>,
    );
    const el = screen.getByTestId("callout");
    expect(el.className).toContain("border-destructive/50");
  });

  it("merges custom className", () => {
    render(
      <Callout variant="info" className="mb-4" data-testid="callout">
        content
      </Callout>,
    );
    const el = screen.getByTestId("callout");
    expect(el.className).toContain("mb-4");
    expect(el.className).toContain("border-blue-200");
  });

  it("renders children", () => {
    render(<Callout variant="info">Hello</Callout>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
