import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockPathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

vi.mock("@/components/shared/push-toggle", () => ({
  PushToggle: () => <div data-testid="push-toggle" />,
}));

// Import after mocks
import { AppSidebar } from "@/components/shared/app-sidebar";
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  _resetSidebarCollapsed,
} from "@/hooks/use-sidebar-collapsed";

describe("AppSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetSidebarCollapsed();
    mockPathname.mockReturnValue("/");
  });

  it("renders the full nav with labels when expanded", () => {
    render(<AppSidebar />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("New Workspace")).toBeInTheDocument();
    expect(screen.getByText("Utilities")).toBeInTheDocument();
    // Sub-items are only rendered in the expanded state
    expect(screen.getByText("Quick (no AI)")).toBeInTheDocument();
    expect(screen.getByText("Claude Usage")).toBeInTheDocument();
  });

  it("collapses to an icon rail that keeps the top-level links reachable", async () => {
    const user = userEvent.setup();
    render(<AppSidebar />);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // Labels are gone, but the destinations remain as links with accessible names
    expect(screen.queryByText("New Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick (no AI)")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "New Workspace" }),
    ).toHaveAttribute("href", "/new");
    expect(screen.getByRole("link", { name: "Utilities" })).toHaveAttribute(
      "href",
      "/utilities",
    );
  });

  it("persists the collapsed state and restores it on mount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AppSidebar />);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("true");
    unmount();

    render(<AppSidebar />);
    expect(screen.queryByText("New Workspace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("expands again from the collapsed rail", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    await user.click(screen.getByRole("button", { name: /expand sidebar/i }));
    expect(screen.getByText("New Workspace")).toBeInTheDocument();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("false");
  });

  it("reveals a section's sub-items in a flyout while hovering the collapsed rail", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    expect(screen.queryByText("Claude Usage")).not.toBeInTheDocument();

    await user.hover(screen.getByRole("link", { name: "Utilities" }));
    expect(screen.getByRole("link", { name: "Claude Usage" })).toHaveAttribute(
      "href",
      "/utilities/claude-usage",
    );
    // Only the hovered section opens
    expect(screen.queryByText("Quick (no AI)")).not.toBeInTheDocument();

    await user.unhover(screen.getByRole("link", { name: "Utilities" }));
    expect(screen.queryByText("Claude Usage")).not.toBeInTheDocument();
  });

  it("renders the flyout inside the hovered item so the pointer can reach it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    const icon = screen.getByRole("link", { name: "New Workspace" });
    await user.hover(icon);

    // The element that closes on mouse leave has to contain the sub-items,
    // or moving the pointer onto one of them dismisses the flyout.
    expect(icon.parentElement).toContainElement(
      screen.getByRole("link", { name: "Quick (no AI)" }),
    );
  });

  it("opens the flyout for keyboard focus and keeps it open inside", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    // Expand button, Dashboard, then New Workspace
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "New Workspace" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Quick (no AI)" })).toBeVisible();

    await user.tab();
    expect(screen.getByRole("link", { name: "Quick (no AI)" })).toHaveFocus();
  });

  it("closes the flyout once focus leaves the section", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByText("Quick (no AI)")).toBeInTheDocument();

    // Past the flyout's own links, into Utilities
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "Utilities" })).toHaveFocus();
    expect(screen.queryByText("Quick (no AI)")).not.toBeInTheDocument();
    expect(screen.getByText("Claude Usage")).toBeInTheDocument();
  });

  it("has no flyout for a section without sub-items", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    render(<AppSidebar />);

    await user.hover(screen.getByRole("link", { name: "Dashboard" }));
    expect(screen.getAllByRole("link", { name: "Dashboard" })).toHaveLength(1);
  });

  it("does not leave a flyout open across a collapse", async () => {
    const user = userEvent.setup();
    render(<AppSidebar />);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Claude Usage")).not.toBeInTheDocument();
  });

  it("marks the section matching the current path as current", () => {
    mockPathname.mockReturnValue("/utilities/claude-usage");
    render(<AppSidebar />);
    expect(screen.getByRole("link", { name: "Utilities" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
