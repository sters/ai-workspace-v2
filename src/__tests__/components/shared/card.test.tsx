import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/shared/containers/card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Hello World</Card>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  // tailwind-merge has to let the caller's utility win over the variant's.
  it("lets a custom className override the variant's own utilities", () => {
    render(
      <Card className="p-8" data-testid="card">
        content
      </Card>,
    );
    const el = screen.getByTestId("card");
    expect(el.className).toContain("p-8");
    expect(el.className).not.toContain("p-4");
  });
});
