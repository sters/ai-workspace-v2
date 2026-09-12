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
