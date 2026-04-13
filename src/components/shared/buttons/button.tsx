"use client";

import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useAsyncCallback } from "@/hooks/use-async-callback";
import type { ButtonVariant } from "@/types/components";

const variants: Record<ButtonVariant, string> = {
  primary:
    "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
  secondary:
    "rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50",
  destructive:
    "rounded-md border border-red-300 bg-transparent px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950",
  "destructive-sm":
    "rounded-md border border-destructive/50 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10",
  outline:
    "rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50",
  "outline-muted":
    "rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted",
  ghost:
    "text-xs text-muted-foreground underline hover:text-foreground",
  "ghost-toggle":
    "text-muted-foreground hover:text-foreground disabled:opacity-50",
};

export function buttonVariants(variant: ButtonVariant = "primary", className?: string) {
  return cn(variants[variant], className);
}

export function Button({
  variant = "primary",
  className,
  onClick,
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  variant?: ButtonVariant;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
}) {
  const [wrappedOnClick, pending] = useAsyncCallback(onClick);
  return (
    <button
      className={cn("inline-flex items-center gap-1", variants[variant], className)}
      onClick={wrappedOnClick}
      disabled={disabled || pending}
      {...props}
    />
  );
}
