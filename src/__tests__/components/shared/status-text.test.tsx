import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusText } from "@/components/shared/feedback/status-text";

describe("StatusText", () => {
  it("renders children text", () => {
    render(<StatusText>Loading...</StatusText>);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("defaults to muted variant", () => {
    render(<StatusText>Test</StatusText>);
    const el = screen.getByText("Test");
    expect(el.className).toContain("text-muted-foreground");
  });

  it("applies error variant", () => {
    render(<StatusText variant="error">Failed</StatusText>);
    const el = screen.getByText("Failed");
    expect(el.className).toContain("text-destructive");
    expect(el.className).not.toContain("text-muted-foreground");
  });

  it("renders as a p element", () => {
    render(<StatusText>Text</StatusText>);
    expect(screen.getByText("Text").tagName).toBe("P");
  });

  it("merges additional className", () => {
    render(<StatusText className="mb-4">Text</StatusText>);
    const el = screen.getByText("Text");
    expect(el.className).toContain("mb-4");
  });
});
