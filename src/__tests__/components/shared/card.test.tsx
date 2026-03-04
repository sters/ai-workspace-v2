import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, cardVariants } from "@/components/shared/containers/card";

describe("Card", () => {
  it("renders default variant with rounded-lg border p-4", () => {
    render(<Card data-testid="card">content</Card>);
    const el = screen.getByTestId("card");
    expect(el.className).toContain("rounded-lg");
    expect(el.className).toContain("border");
    expect(el.className).toContain("p-4");
  });

  it("renders flush variant without padding", () => {
    render(
      <Card variant="flush" data-testid="card">
        content
      </Card>,
    );
    const el = screen.getByTestId("card");
    expect(el.className).toContain("rounded-lg");
    expect(el.className).toContain("border");
    expect(el.className).not.toContain("p-4");
  });

  it("renders dashed variant with border-dashed", () => {
    render(
      <Card variant="dashed" data-testid="card">
        content
      </Card>,
    );
    const el = screen.getByTestId("card");
    expect(el.className).toContain("border-dashed");
    expect(el.className).toContain("p-4");
  });

  it("merges custom className", () => {
    render(
      <Card className="mb-6 bg-red-500" data-testid="card">
        content
      </Card>,
    );
    const el = screen.getByTestId("card");
    expect(el.className).toContain("mb-6");
    expect(el.className).toContain("bg-red-500");
    expect(el.className).toContain("rounded-lg");
  });

  it("renders children", () => {
    render(<Card>Hello World</Card>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });
});

describe("cardVariants", () => {
  it("returns default variant classes", () => {
    const classes = cardVariants();
    expect(classes).toContain("rounded-lg");
    expect(classes).toContain("border");
    expect(classes).toContain("p-4");
  });

  it("returns flush variant classes", () => {
    const classes = cardVariants("flush");
    expect(classes).toContain("rounded-lg");
    expect(classes).toContain("border");
    expect(classes).not.toContain("p-4");
  });

  it("merges additional className", () => {
    const classes = cardVariants("default", "block hover:bg-accent");
    expect(classes).toContain("rounded-lg");
    expect(classes).toContain("block");
    expect(classes).toContain("hover:bg-accent");
  });
});
