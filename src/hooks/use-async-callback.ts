"use client";

import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Wraps an event handler that may return a Promise.
 * While the Promise is pending, `pending` is true — useful for disabling buttons.
 */
export function useAsyncCallback<Args extends unknown[]>(
  fn: ((...args: Args) => void | Promise<unknown>) | undefined
): [(...args: Args) => void, boolean] {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const wrapped = useCallback(
    (...args: Args) => {
      if (!fn || pendingRef.current) return;
      const result = fn(...args);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        pendingRef.current = true;
        setPending(true);
        (result as Promise<unknown>)
          .catch(() => {})
          .finally(() => {
            pendingRef.current = false;
            if (isMountedRef.current) {
              setPending(false);
            }
          });
      }
    },
    [fn]
  );

  return [wrapped, pending];
}
