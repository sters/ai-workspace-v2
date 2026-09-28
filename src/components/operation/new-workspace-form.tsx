"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { InitSplitButton } from "./init-split-button";
import { StatusText } from "@/components/shared/feedback/status-text";
import { InteractionLevelSelector } from "@/components/shared/forms/interaction-level-selector";
import { RepositoryPicker } from "@/components/shared/forms/repository-picker";
import { SnippetPicker } from "@/components/shared/forms/snippet-picker";
import { postJson } from "@/lib/api";
import { SELECTED_REPOS_HEADING, withSelectedRepositories } from "@/lib/task-description";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

/** The routes answer a refusal with `{ error }`; anything else is shown as it came. */
function refusalReason(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === "string" && error.trim()) return error;
  } catch {
    // Not JSON — the text is the best answer there is.
  }
  return raw;
}

export function NewWorkspaceForm({
  initialDescription = "",
}: {
  /** Handed over by another page, e.g. a suggestion's `?description=`. */
  initialDescription?: string;
}) {
  const { mutate } = useSWRConfig();
  const [description, setDescription] = useState(initialDescription);
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const composed = useMemo(
    () => withSelectedRepositories(description, selected),
    [description, selected],
  );

  const toggle = (repoPath: string) => {
    setSelected((prev) =>
      prev.includes(repoPath) ? prev.filter((p) => p !== repoPath) : [...prev, repoPath],
    );
  };

  const describe = (next: string) => {
    setDescription(next);
    setConfirmed(false);
    setError(null);
  };

  /**
   * The run is followed in the history below, so starting one leaves the form
   * ready for the next request rather than disabled around a log. The request
   * survives a refusal — it is the only copy of what the user wrote.
   */
  const start = async (type: OperationType, body: Record<string, string>) => {
    setError(null);
    setConfirmed(false);
    const res = await postJson(`/api/operations/${type}`, body);
    if (!res.ok) {
      setError(refusalReason(res.error));
      return;
    }
    setDescription("");
    setSelected([]);
    setConfirmed(true);
    mutate((key) => typeof key === "string" && key.startsWith("/api/operations"), undefined, {
      revalidate: true,
    });
  };

  return (
    <div className="w-full space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="new-description" className="text-xs font-medium">
            Task Description
          </label>
          <SnippetPicker
            onInsert={(content) =>
              describe(description.trim() ? `${description}\n\n${content}` : content)
            }
          />
        </div>
        <textarea
          id="new-description"
          value={description}
          onChange={(e) => describe(e.target.value)}
          placeholder={"e.g., Add retry logic to the payment service in github.com/org/payment-api\ne.g., https://example.atlassian.net/browse/PROJ-123 を実装する\ne.g., github.com/org/frontend と github.com/org/api に認証機能を追加"}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          rows={6}
          autoFocus
        />
      </div>

      <div>
        <RepositoryPicker
          selected={selected}
          onToggle={toggle}
          emptyHint="No repository has been cloned yet. Name one in the description and it will be cloned."
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Ticked repositories are appended to the description under{" "}
          <code className="font-mono">{SELECTED_REPOS_HEADING}</code>, which is where the run reads
          them from — so a repository named in the description works just as well.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">Interaction Level</label>
        <InteractionLevelSelector value={interactionLevel} onChange={setInteractionLevel} />
        <p className="mt-1 text-xs text-muted-foreground">
          {interactionLevel === "low"
            ? "AI decides autonomously. Asks only when critical info is missing."
            : interactionLevel === "mid"
              ? "Asks about important unknowns like missing repositories."
              : "Confirms scope, approach, and requirements. Adds checkpoints during TODO planning."}
        </p>
      </div>

      <InitSplitButton
        description={composed}
        interactionLevel={interactionLevel}
        start={start}
      />

      {error && <StatusText variant="error">Failed to start: {error}</StatusText>}
      {confirmed && <StatusText>Started — it is listed under Recent New Operations below.</StatusText>}
    </div>
  );
}
