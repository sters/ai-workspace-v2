"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  loadChatSelections,
  saveChatSelections,
  type ChatSelection,
} from "@/lib/chat-selection";

/**
 * The Changes tab's collected selections, per workspace. `sessionStorage` is
 * where they are persisted, so moving to another tab and back keeps them; this
 * cache is the live value, which gives `useSyncExternalStore` a snapshot that
 * does not parse storage on every render.
 */
const cache = new Map<string, ChatSelection[]>();
const listeners = new Set<() => void>();
const EMPTY: ChatSelection[] = [];

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function read(workspaceName: string): ChatSelection[] {
  let items = cache.get(workspaceName);
  if (!items) {
    items = loadChatSelections(workspaceName);
    cache.set(workspaceName, items);
  }
  return items;
}

function write(workspaceName: string, items: ChatSelection[]): void {
  cache.set(workspaceName, items);
  saveChatSelections(workspaceName, items);
  for (const listener of listeners) listener();
}

export function useChatSelections(workspaceName: string) {
  const items = useSyncExternalStore(
    subscribe,
    () => read(workspaceName),
    // The server has no storage, so it renders none.
    () => EMPTY,
  );

  const add = useCallback(
    (item: ChatSelection) => write(workspaceName, [...read(workspaceName), item]),
    [workspaceName],
  );
  const remove = useCallback(
    (id: string) => write(workspaceName, read(workspaceName).filter((i) => i.id !== id)),
    [workspaceName],
  );
  const clear = useCallback(() => write(workspaceName, []), [workspaceName]);

  return { items, add, remove, clear };
}
