import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/shared/feedback/page-header";

describe("PageHeader", () => {
  it("does not render refresh button when onRefresh is omitted", () => {
    render(<PageHeader title="T" description="D" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onRefresh when button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<PageHeader title="T" description="D" onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
