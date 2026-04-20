"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import type { Snippet } from "@/types/snippet";
import { fetcher } from "@/lib/api";

interface SnippetsResponse {
  snippets: Snippet[];
}

interface SnippetPickerProps {
  onInsert: (content: string) => void;
  disabled?: boolean;
}

export function SnippetPicker({ onInsert, disabled }: SnippetPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useSWR<SnippetsResponse>(
    open ? "/api/snippets" : null,
    fetcher,
  );

  const snippets = data?.snippets ?? [];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        Insert Snippet ▾
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border bg-card shadow-lg">
          {snippets.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">
              No snippets yet.{" "}
              <Link href="/utilities/snippets" className="underline hover:text-foreground">
                Create one
              </Link>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              {snippets.map((snippet) => (
                <button
                  key={snippet.id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onInsert(snippet.content);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{snippet.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {snippet.content.slice(0, 80)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
