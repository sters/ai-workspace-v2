import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/shared/feedback/page-header";

describe("PageHeader", () => {
  it("renders title and description", () => {
    render(<PageHeader title="My Title" description="My description" />);
    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(screen.getByText("My description")).toBeInTheDocument();
  });

  it("renders refresh button when onRefresh is provided", () => {
    render(
      <PageHeader title="T" description="D" onRefresh={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

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

  it("uses custom refreshLabel", () => {
    render(
      <PageHeader
        title="T"
        description="D"
        onRefresh={() => {}}
        refreshLabel="Check Status"
      />
    );
    expect(
      screen.getByRole("button", { name: "Check Status" })
    ).toBeInTheDocument();
  });

  it("renders h1 for title", () => {
    render(<PageHeader title="Heading" description="D" />);
    const h1 = screen.getByText("Heading");
    expect(h1.tagName).toBe("H1");
  });
});
