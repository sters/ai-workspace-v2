"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type ToastVariant = "info" | "error";

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
}

let nextId = 1;
let entries: ToastEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Show a transient message. Auto-dismisses after 5s. */
export function showToast(message: string, variant: ToastVariant = "info") {
  const id = nextId++;
  entries = [...entries, { id, message, variant }];
  emit();
  setTimeout(() => {
    entries = entries.filter((e) => e.id !== id);
    emit();
  }, 5000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: ToastEntry[] = [];
const getSnapshot = () => entries;
const getServerSnapshot = () => EMPTY;

/**
 * Mount this once near the app root. Renders a stack of toasts in the bottom-
 * right corner. Subscribes to the module-level toast queue.
 */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (items.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((entry) => (
        <div
          key={entry.id}
          role={entry.variant === "error" ? "alert" : "status"}
          className={[
            "pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg ring-1",
            entry.variant === "error"
              ? "bg-red-50 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-100 dark:ring-red-800"
              : "bg-slate-50 text-slate-900 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700",
          ].join(" ")}
        >
          {entry.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}
