"use client";

import { useSyncExternalStore } from "react";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "aiw:sidebar-collapsed";

/**
 * The live value; `localStorage` is only where it is persisted. Holding it here
 * keeps the toggle working when storage is unavailable (private mode), and
 * gives `useSyncExternalStore` a snapshot that never touches storage per render.
 * `null` means "not read yet".
 */
let current: boolean | null = null;

/**
 * Subscribers within this tab. The `storage` event only fires in *other* tabs,
 * so a local write has to notify them directly.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  // A null key means the whole store was cleared.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY) {
      return;
    }
    current = null;
    onChange();
  };

  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): boolean {
  if (current === null) {
    try {
      current = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      current = false;
    }
  }
  return current;
}

/** The server has no storage, so it renders the expanded sidebar. */
function getServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  current = collapsed;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Not persisted across reloads, but applied for this session.
  }
  for (const listener of listeners) listener();
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test-only: drop the cached value so the next read hits storage again. */
export function _resetSidebarCollapsed(): void {
  current = null;
}
