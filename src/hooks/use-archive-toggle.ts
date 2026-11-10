"use client";

import { useState } from "react";

export interface OpenPullRequestInfo {
  repoName: string;
  url: string;
  title: string;
}

/**
 * Archive / unarchive a workspace. When the route refuses because PRs are
 * still open, the list is held in `openPrs` until the caller confirms
 * (closing them) or cancels.
 */
export function useArchiveToggle(onDone: () => void) {
  const [pending, setPending] = useState<{ name: string; prs: OpenPullRequestInfo[] } | null>(null);

  const post = async (name: string, closeOpenPrs: boolean) => {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(name)}/archive`,
      closeOpenPrs
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closeOpenPrs: true }) }
        : { method: "POST" },
    );
    const body = (await res.json().catch(() => null)) as
      | { error?: string; openPullRequests?: OpenPullRequestInfo[] }
      | null;
    if (res.status === 409 && body?.openPullRequests) {
      setPending({ name, prs: body.openPullRequests });
      return;
    }
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    setPending(null);
    onDone();
  };

  return {
    toggle: (name: string) => post(name, false),
    openPrs: pending?.prs ?? null,
    confirmClose: () => (pending ? post(pending.name, true) : Promise.resolve()),
    cancel: () => setPending(null),
  };
}
