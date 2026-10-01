"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The height that takes an element from where it sits on the page to the
 * bottom of the viewport, for a panel that should fill the screen whatever its
 * content's length.
 *
 * Measured from the document rather than the viewport, so the answer does not
 * depend on how far the page happened to be scrolled when it was taken, and
 * re-measured on a window resize and whenever the page's layout moves (content
 * appearing above the element shifts its top). Scrolling does not re-measure:
 * resizing an editor on every scroll frame would fight the scroll.
 */
export function useViewportFillHeight({
  bottomGap = 0,
  minHeight = 0,
}: {
  /** Pixels to leave below the element — the page's own bottom padding. */
  bottomGap?: number;
  minHeight?: number;
} = {}): { attach: (el: HTMLElement | null) => void; height: number | null } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback(
    (target: HTMLElement) => {
      const top = target.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minHeight, Math.round(window.innerHeight - top - bottomGap)));
    },
    [bottomGap, minHeight],
  );

  // Measured in the ref callback rather than the effect, so the first frame
  // already has the height.
  const attach = useCallback(
    (target: HTMLElement | null) => {
      setEl(target);
      if (target) measure(target);
    },
    [measure],
  );

  useEffect(() => {
    if (!el) return;
    const remeasure = () => measure(el);
    window.addEventListener("resize", remeasure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
  }, [el, measure]);

  return { attach, height };
}
