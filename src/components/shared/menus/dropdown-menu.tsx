"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * One item in a DropdownMenu. Either a leaf (terminal action) or a group
 * (opens a submenu of leaves). Submenus are not nested further — one level
 * deep is sufficient for the current callers and keeps focus management
 * tractable.
 */
export type DropdownItem =
  | {
      kind: "leaf";
      label: ReactNode;
      onSelect: () => void | Promise<unknown>;
      disabled?: boolean;
    }
  | {
      kind: "group";
      label: ReactNode;
      items: DropdownLeaf[];
    };

export interface DropdownLeaf {
  label: ReactNode;
  onSelect: () => void | Promise<unknown>;
  disabled?: boolean;
}

const itemClass =
  "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50";

/**
 * A trigger button that opens a popover menu of items. Items can be leaves
 * (run a callback) or groups (open a submenu to the right). Keyboard nav:
 * ↑/↓ within a level, → enters a group, ← / Esc closes the group / menu.
 */
const DEFAULT_TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50";

export function DropdownMenu({
  trigger,
  items,
  disabled,
  ariaLabel,
  triggerClassName,
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  disabled?: boolean;
  ariaLabel?: string;
  /** Override the trigger button's className. Defaults to a "secondary" button style. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const topItemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const subItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setOpenGroup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const closeAll = useCallback(() => {
    setOpen(false);
    setOpenGroup(null);
    triggerRef.current?.focus();
  }, []);

  const runLeaf = useCallback(
    (leaf: DropdownLeaf) => {
      if (leaf.disabled) return;
      closeAll();
      void leaf.onSelect();
    },
    [closeAll],
  );

  const handleTopKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const item = items[index];
      if (e.key === "Escape") {
        e.preventDefault();
        closeAll();
        return;
      }
      const buttons = topItemsRef.current.filter(Boolean) as HTMLButtonElement[];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        buttons[(index + 1) % buttons.length]?.focus();
        setOpenGroup(null);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
        setOpenGroup(null);
      } else if (e.key === "ArrowRight" && item.kind === "group") {
        e.preventDefault();
        setOpenGroup(index);
        // Defer to next tick so the submenu has rendered
        setTimeout(() => subItemsRef.current[0]?.focus(), 0);
      } else if (e.key === "Enter" || e.key === " ") {
        if (item.kind === "leaf") {
          e.preventDefault();
          runLeaf(item);
        } else if (item.kind === "group") {
          e.preventDefault();
          setOpenGroup(index);
          setTimeout(() => subItemsRef.current[0]?.focus(), 0);
        }
      }
    },
    [items, closeAll, runLeaf],
  );

  const handleSubKeyDown = useCallback(
    (e: React.KeyboardEvent, leafIndex: number, groupIndex: number) => {
      const group = items[groupIndex];
      if (group.kind !== "group") return;
      const leaves = group.items;
      const buttons = subItemsRef.current.filter(Boolean) as HTMLButtonElement[];
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        e.preventDefault();
        setOpenGroup(null);
        topItemsRef.current[groupIndex]?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        buttons[(leafIndex + 1) % buttons.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        buttons[(leafIndex - 1 + buttons.length) % buttons.length]?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        runLeaf(leaves[leafIndex]);
      }
    },
    [items, runLeaf],
  );

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((prev) => !prev);
          setOpenGroup(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setOpenGroup(null);
          } else if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            topItemsRef.current[0]?.focus();
          }
        }}
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border bg-background py-1 shadow-md"
        >
          {items.map((item, idx) => {
            if (item.kind === "leaf") {
              return (
                <button
                  key={idx}
                  type="button"
                  ref={(el) => {
                    topItemsRef.current[idx] = el;
                  }}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => runLeaf(item)}
                  onKeyDown={(e) => handleTopKeyDown(e, idx)}
                  className={itemClass}
                >
                  {item.label}
                </button>
              );
            }
            const isGroupOpen = openGroup === idx;
            return (
              <div key={idx} className="relative">
                <button
                  type="button"
                  ref={(el) => {
                    topItemsRef.current[idx] = el;
                  }}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={isGroupOpen}
                  onClick={() => {
                    setOpenGroup(idx);
                    setTimeout(() => subItemsRef.current[0]?.focus(), 0);
                  }}
                  onMouseEnter={() => setOpenGroup(idx)}
                  onKeyDown={(e) => handleTopKeyDown(e, idx)}
                  className={itemClass}
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    ▶
                  </span>
                </button>
                {isGroupOpen && (
                  <div
                    role="menu"
                    className="absolute left-full top-0 z-50 ml-1 min-w-[260px] rounded-md border bg-background py-1 shadow-md"
                  >
                    {item.items.map((leaf, leafIdx) => (
                      <button
                        key={leafIdx}
                        type="button"
                        ref={(el) => {
                          subItemsRef.current[leafIdx] = el;
                        }}
                        role="menuitem"
                        disabled={leaf.disabled}
                        onClick={() => runLeaf(leaf)}
                        onKeyDown={(e) => handleSubKeyDown(e, leafIdx, idx)}
                        className={itemClass}
                      >
                        {leaf.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
