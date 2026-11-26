import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; replace?: boolean };

function opensElsewhere(event: MouseEvent<HTMLAnchorElement>, target: string | undefined): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (!!target && target !== "_self")
  );
}

/** An anchor that navigates in-app for a plain click and leaves every other click to the browser. */
export default function Link({ href, replace, onClick, target, ...props }: LinkProps) {
  const navigate = useNavigate();
  return (
    <a
      {...props}
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || opensElsewhere(event, target) || !href.startsWith("/")) return;
        event.preventDefault();
        void navigate({ href, replace });
      }}
    />
  );
}
