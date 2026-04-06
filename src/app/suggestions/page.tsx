"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useOperation } from "@/hooks/use-operation";
import { useSuggestions } from "@/hooks/use-suggestions";
import { postJson } from "@/lib/api";
import { INIT_STORAGE_KEY, InitSplitButton } from "@/components/operation/init-operation";
import { InteractionLevelSelector } from "@/components/shared/forms/interaction-level-selector";
import { CollapsibleSection } from "@/components/shared/containers/collapsible-section";
import { X, Search, Trash2, Layers } from "lucide-react";
import Link from "next/link";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

const AGGREGATE_STORAGE_KEY = "aggregate-suggestions";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export default function SuggestionsPage() {
  const { suggestions, isLoading, refresh } = useSuggestions();
  const { start } = useOperation(INIT_STORAGE_KEY);
  const { start: startAggregate } = useOperation(AGGREGATE_STORAGE_KEY);
  const router = useRouter();
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const [starting, setStarting] = useState(false);
  const [query, setQuery] = useState("");
  const handleAggregate = useCallback(() => {
    startAggregate("aggregate-suggestions", {}).then(() =>
      router.push("/suggestions/aggregate"),
    );
  }, [startAggregate, router]);

  async function handleDismiss(id: string) {
    await postJson("/api/suggestions/dismiss", { id });
    refresh();
  }

  function handleStart(suggestionId: string, type: OperationType, body: Record<string, string>) {
    setStarting(true);
    Promise.all([
      start(type, body),
      postJson("/api/suggestions/dismiss", { id: suggestionId }),
    ])
      .then(() => router.push("/new"))
      .catch(() => setStarting(false));
  }

  const lowerQuery = query.toLowerCase();
  const filtered = query
    ? suggestions.filter(
        (s) =>
          s.title.toLowerCase().includes(lowerQuery) ||
          s.description.toLowerCase().includes(lowerQuery) ||
          s.targetRepository.toLowerCase().includes(lowerQuery) ||
          s.sourceWorkspace.toLowerCase().includes(lowerQuery),
      )
    : suggestions;

  return (
    <div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium">
              Interaction Level
            </label>
            <InteractionLevelSelector
              value={interactionLevel}
              onChange={setInteractionLevel}
              disabled={starting}
            />
          </div>

          <button
            onClick={handleAggregate}
            disabled={starting || suggestions.length < 2}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            title="Merge similar suggestions using AI"
          >
            <Layers className="h-3.5 w-3.5" />
            Aggregate
          </button>

          <Link
            href="/suggestions/prune"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Check if suggestions have been resolved in their repos"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Prune
          </Link>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suggestions..."
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {!isLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No suggestions yet. Suggestions are generated after execute, review, or autonomous operations.
          </p>
        )}

        {!isLoading && suggestions.length > 0 && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No suggestions match &quot;{query}&quot;.
          </p>
        )}

        <div className="space-y-4">
          {Object.entries(
            filtered.reduce<Record<string, typeof filtered>>((acc, s) => {
              const key = s.targetRepository || "(unknown)";
              (acc[key] ??= []).push(s);
              return acc;
            }, {}),
          ).map(([repo, items]) => (
            <CollapsibleSection
              key={repo}
              title={repo}
              badge={`(${items.length})`}
            >
              <div className="space-y-2">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium">{s.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          from {s.sourceWorkspace}
                          <span className="mx-1.5">·</span>
                          <span title={new Date(s.createdAt).toLocaleString()}>
                            {formatRelativeTime(s.createdAt)}
                          </span>
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {s.description}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDismiss(s.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                        title="Dismiss"
                        aria-label="Dismiss suggestion"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3">
                      <InitSplitButton
                        description={s.description}
                        interactionLevel={interactionLevel}
                        start={(type, body) => handleStart(s.id, type, body)}
                        disabled={starting}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          ))}
        </div>
      </div>
    </div>
  );
}
