import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusText } from "@/components/shared/feedback/status-text";

describe("StatusText", () => {
  it("renders children text", () => {
    render(<StatusText>Loading...</StatusText>);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("switches off the muted colour for the error variant", () => {
    render(<StatusText variant="error">Failed</StatusText>);
    const el = screen.getByText("Failed");
    expect(el.className).toContain("text-destructive");
    expect(el.className).not.toContain("text-muted-foreground");
  });
});
