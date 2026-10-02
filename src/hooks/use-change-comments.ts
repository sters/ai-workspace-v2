"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  loadChangeComments,
  saveChangeComments,
  type ChangeComment,
} from "@/lib/change-comments";

/**
 * The Changes tab's comments, per workspace. `sessionStorage` is where they are
 * persisted, so moving to another tab and back keeps them; this cache is the
 * live value, which gives `useSyncExternalStore` a snapshot that does not parse
 * storage on every render.
 */
const cache = new Map<string, ChangeComment[]>();
const listeners = new Set<() => void>();
const EMPTY: ChangeComment[] = [];

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function read(workspaceName: string): ChangeComment[] {
  let items = cache.get(workspaceName);
  if (!items) {
    items = loadChangeComments(workspaceName);
    cache.set(workspaceName, items);
  }
  return items;
}

function write(workspaceName: string, items: ChangeComment[]): void {
  cache.set(workspaceName, items);
  saveChangeComments(workspaceName, items);
  for (const listener of listeners) listener();
}

export function useChangeComments(workspaceName: string) {
  const items = useSyncExternalStore(
    subscribe,
    () => read(workspaceName),
    // The server has no storage, so it renders none.
    () => EMPTY,
  );

  const add = useCallback(
    (item: ChangeComment) => write(workspaceName, [...read(workspaceName), item]),
    [workspaceName],
  );
  const setComment = useCallback(
    (id: string, comment: string) =>
      write(
        workspaceName,
        read(workspaceName).map((i) => (i.id === id ? { ...i, comment } : i)),
      ),
    [workspaceName],
  );
  const remove = useCallback(
    (id: string) => write(workspaceName, read(workspaceName).filter((i) => i.id !== id)),
    [workspaceName],
  );
  const clear = useCallback(() => write(workspaceName, []), [workspaceName]);

  return { items, add, setComment, remove, clear };
}
