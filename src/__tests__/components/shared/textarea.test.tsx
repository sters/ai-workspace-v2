import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Textarea } from "@/components/shared/forms/textarea";

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea aria-label="input" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("applies base styling classes", () => {
    render(<Textarea aria-label="input" />);
    const el = screen.getByRole("textbox");
    expect(el.className).toContain("rounded-md");
    expect(el.className).toContain("border");
    expect(el.className).toContain("bg-background");
    expect(el.className).toContain("text-sm");
    expect(el.className).toContain("resize-y");
  });

  it("passes through placeholder", () => {
    render(<Textarea placeholder="Type here..." />);
    expect(screen.getByPlaceholderText("Type here...")).toBeInTheDocument();
  });

  it("passes through disabled prop", () => {
    render(<Textarea aria-label="input" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("passes through value and onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Textarea aria-label="input" value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("merges additional className", () => {
    render(<Textarea aria-label="input" className="mt-4" />);
    const el = screen.getByRole("textbox");
    expect(el.className).toContain("mt-4");
  });

  it("passes through rows prop", () => {
    render(<Textarea aria-label="input" rows={5} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "5");
  });
});
