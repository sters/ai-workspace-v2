import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "@/components/shared/containers/callout";

describe("Callout", () => {
  it("renders children", () => {
    render(<Callout variant="info">Hello</Callout>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("merges custom className", () => {
    render(
      <Callout variant="info" className="mb-4" data-testid="callout">
        content
      </Callout>,
    );
    expect(screen.getByTestId("callout").className).toContain("mb-4");
  });
});
