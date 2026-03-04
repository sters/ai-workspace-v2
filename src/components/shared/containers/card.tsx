import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

const cardStyles = {
  default: "rounded-lg border p-4",
  flush: "rounded-lg border",
  dashed: "rounded-lg border border-dashed p-4",
};

export type CardVariant = keyof typeof cardStyles;

export function cardVariants(
  variant: CardVariant = "default",
  className?: string,
): string {
  return cn(cardStyles[variant], className);
}

export function Card({
  variant = "default",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { variant?: CardVariant }) {
  return (
    <div className={cardVariants(variant, className)} {...props}>
      {children}
    </div>
  );
}
