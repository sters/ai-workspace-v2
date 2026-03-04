import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/shared/buttons/button";

describe("Button", () => {
  it("renders children text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("defaults to primary variant", () => {
    render(<Button>Primary</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("text-primary-foreground");
  });

  it("applies secondary variant", () => {
    render(<Button variant="secondary">Secondary</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("bg-secondary");
    expect(el.className).toContain("text-secondary-foreground");
  });

  it("applies destructive variant", () => {
    render(<Button variant="destructive">Delete</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("border-red-300");
    expect(el.className).toContain("text-red-600");
  });

  it("applies destructive-sm variant", () => {
    render(<Button variant="destructive-sm">Cancel</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("border-destructive/50");
    expect(el.className).toContain("text-destructive");
    expect(el.className).toContain("text-xs");
  });

  it("applies outline variant", () => {
    render(<Button variant="outline">Retry</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("hover:bg-accent");
    expect(el.className).toContain("text-xs");
  });

  it("applies outline-muted variant", () => {
    render(<Button variant="outline-muted">Refresh</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("hover:bg-muted");
    expect(el.className).toContain("text-xs");
  });

  it("applies ghost variant", () => {
    render(<Button variant="ghost">Clear</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("underline");
    expect(el.className).toContain("text-muted-foreground");
  });

  it("applies ghost-toggle variant", () => {
    render(<Button variant="ghost-toggle">Toggle</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toContain("hover:text-foreground");
    expect(el.className).not.toContain("underline");
  });

  it("merges additional className", () => {
    render(<Button className="ml-2">Test</Button>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("ml-2");
  });

  it("passes through disabled prop", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("passes through onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("passes through type prop", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});
