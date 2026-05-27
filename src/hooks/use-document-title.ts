"use client";

import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | ai-workspace`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
