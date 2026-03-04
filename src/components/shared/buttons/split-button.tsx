"use client";

import { useState, useRef, useEffect } from "react";

export interface SplitButtonItem {
  label: string;
  onClick: () => void;
}

const splitVariants = {
  primary: {
    main: "rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
    dropdown:
      "rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
  },
  secondary: {
    main: "rounded-l-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50",
    dropdown:
      "rounded-r-md border-l border-secondary-foreground/20 bg-secondary px-1.5 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50",
  },
  outline: {
    main: "rounded-l-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50",
    dropdown:
      "rounded-r-md border border-l-0 bg-background px-1.5 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50",
  },
};

export type SplitButtonVariant = keyof typeof splitVariants;

export function SplitButton({
  label,
  onClick,
  items,
  disabled,
  variant = "primary",
  className,
  dropdownClassName,
}: {
  label: string;
  onClick: () => void;
  items: SplitButtonItem[];
  disabled?: boolean;
  variant?: SplitButtonVariant;
  className?: string;
  dropdownClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const mainClass = className ?? splitVariants[variant].main;
  const dropClass = dropdownClassName ?? splitVariants[variant].dropdown;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={onClick}
        disabled={disabled}
        className={mainClass}
      >
        {label}
      </button>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={dropClass}
        aria-label="More options"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-md border bg-background py-1 shadow-md">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
