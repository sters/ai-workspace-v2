"use client";

import { useMemo, useState } from "react";
import { InitOperation, InitSplitButton } from "./init-operation";
import { InteractionLevelSelector } from "@/components/shared/forms/interaction-level-selector";
import { RepositoryPicker } from "@/components/shared/forms/repository-picker";
import { SnippetPicker } from "@/components/shared/forms/snippet-picker";
import { SELECTED_REPOS_HEADING, withSelectedRepositories } from "@/lib/task-description";
import type { InteractionLevel } from "@/types/prompts";

export function NewWorkspaceForm({
  initialDescription = "",
}: {
  /** Handed over by another page, e.g. a suggestion's `?description=`. */
  initialDescription?: string;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const [selected, setSelected] = useState<string[]>([]);

  const composed = useMemo(
    () => withSelectedRepositories(description, selected),
    [description, selected],
  );

  const toggle = (repoPath: string) => {
    setSelected((prev) =>
      prev.includes(repoPath) ? prev.filter((p) => p !== repoPath) : [...prev, repoPath],
    );
  };

  return (
    <InitOperation>
      {({ start, started }) => (
        <div className="w-full space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="new-description" className="text-xs font-medium">
                Task Description
              </label>
              <SnippetPicker
                onInsert={(content) =>
                  setDescription((prev) => (prev.trim() ? `${prev}\n\n${content}` : content))
                }
                disabled={started}
              />
            </div>
            <textarea
              id="new-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"e.g., Add retry logic to the payment service in github.com/org/payment-api\ne.g., https://example.atlassian.net/browse/PROJ-123 を実装する\ne.g., github.com/org/frontend と github.com/org/api に認証機能を追加"}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              rows={6}
              autoFocus
              disabled={started}
            />
          </div>

          <div>
            <RepositoryPicker
              selected={selected}
              onToggle={toggle}
              disabled={started}
              emptyHint="No repository has been cloned yet. Name one in the description and it will be cloned."
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Ticked repositories are appended to the description under{" "}
              <code className="font-mono">{SELECTED_REPOS_HEADING}</code>, which is where the run
              reads them from — so a repository named in the description works just as well.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Interaction Level</label>
            <InteractionLevelSelector
              value={interactionLevel}
              onChange={setInteractionLevel}
              disabled={started}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {interactionLevel === "low"
                ? "AI decides autonomously. Asks only when critical info is missing."
                : interactionLevel === "mid"
                  ? "Asks about important unknowns like missing repositories."
                  : "Confirms scope, approach, and requirements. Adds checkpoints during TODO planning."}
            </p>
          </div>

          {!started && (
            <InitSplitButton
              description={composed}
              interactionLevel={interactionLevel}
              start={start}
            />
          )}
        </div>
      )}
    </InitOperation>
  );
}
