"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOperation } from "@/hooks/use-operation";
import { useSuggestions } from "@/hooks/use-suggestions";
import { postJson } from "@/lib/api";
import { INIT_STORAGE_KEY, InitSplitButton } from "@/components/operation/init-operation";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { X } from "lucide-react";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

export default function SuggestionsPage() {
  const { suggestions, isLoading, refresh } = useSuggestions();
  const { start } = useOperation(INIT_STORAGE_KEY);
  const router = useRouter();
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const [starting, setStarting] = useState(false);

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

  return (
    <div>
      <PageHeader
        title="Suggestions"
        description="Out-of-scope items discovered during operations. Click a suggestion to create a new workspace."
      />

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium">
            Interaction Level
          </label>
          <div className="flex gap-1">
            {(["low", "mid", "high"] as const).map((level) => (
              <button
                key={level}
                onClick={() => setInteractionLevel(level)}
                disabled={starting}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  interactionLevel === level
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {level === "low" ? "Low" : level === "mid" ? "Mid" : "High"}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {!isLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No suggestions yet. Suggestions are generated after execute, review, or autonomous operations.
          </p>
        )}

        <div className="space-y-2">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">{s.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    from {s.sourceWorkspace}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {s.description}
                  </p>
                </div>
                <button
                  onClick={() => handleDismiss(s.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  title="Dismiss"
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
      </div>
    </div>
  );
}
