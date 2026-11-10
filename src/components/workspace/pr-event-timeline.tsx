"use client";

import useSWR from "swr";
import { CollapsibleSection } from "@/components/shared/containers/collapsible-section";
import { fetcher } from "@/lib/api";
import type { PrEvent } from "@/types/pr-watch";

/** What the PR watcher has recorded on this workspace's PRs, newest first. */
export function PrEventTimeline({ workspaceName }: { workspaceName: string }) {
  const { data } = useSWR<{ events: PrEvent[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceName)}/pr-events`,
    fetcher,
    { refreshInterval: 60_000 },
  );
  const events = [...(data?.events ?? [])].reverse();
  if (events.length === 0) return null;

  return (
    <CollapsibleSection title={<span className="text-sm font-medium">PR activity</span>} badge={<span className="text-xs text-muted-foreground">{events.length}</span>} defaultOpen={false}>
      <ul className="space-y-1 text-xs">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <time className="shrink-0 text-muted-foreground">{new Date(e.occurredAt).toLocaleString()}</time>
            <span className="shrink-0 font-medium">{e.repoName}</span>
            <span className="shrink-0 rounded bg-muted px-1">{e.kind}</span>
            <span className="min-w-0 truncate" title={e.body}>
              {e.author ? `${e.author}: ` : ""}
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="underline">
                  {e.body}
                </a>
              ) : (
                e.body
              )}
            </span>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
