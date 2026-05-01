import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "@/components/shared/menus/dropdown-menu";

describe("DropdownMenu", () => {
  it("opens the menu on trigger click and shows leaf items", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu
        trigger="Open in..."
        items={[
          { kind: "leaf", label: "Editor", onSelect },
          { kind: "leaf", label: "Terminal", onSelect: vi.fn() },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open in..." }));
    expect(screen.getByRole("menuitem", { name: "Editor" })).toBeInTheDocument();
  });

  it("invokes the leaf onSelect and closes the menu on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu
        trigger="Open"
        items={[{ kind: "leaf", label: "Editor", onSelect }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("menuitem", { name: "Editor" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("opens a submenu when a group item is clicked", async () => {
    const user = userEvent.setup();
    const rootSelect = vi.fn();
    render(
      <DropdownMenu
        trigger="Open"
        items={[
          {
            kind: "group",
            label: "Editor",
            items: [
              { label: "Root", onSelect: rootSelect },
              { label: "repoA", onSelect: vi.fn() },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("menuitem", { name: /Editor/ }));
    expect(screen.getByRole("menuitem", { name: "Root" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Root" }));
    expect(rootSelect).toHaveBeenCalledOnce();
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger="Open"
        items={[{ kind: "leaf", label: "Editor", onSelect: vi.fn() }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("opens a group via ArrowRight on a focused group item", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger="Open"
        items={[
          {
            kind: "group",
            label: "Editor",
            items: [{ label: "Root", onSelect: vi.fn() }],
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    // Focus the first top-level item, then arrow-right into the submenu
    const groupItem = screen.getByRole("menuitem", { name: /Editor/ });
    groupItem.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitem", { name: "Root" })).toBeInTheDocument();
  });
});
