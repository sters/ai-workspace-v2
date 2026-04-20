"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { InitOperation, InitSplitButton } from "@/components/operation/init-operation";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { InteractionLevelSelector } from "@/components/shared/forms/interaction-level-selector";
import { SnippetPicker } from "@/components/shared/forms/snippet-picker";
import type { InteractionLevel } from "@/types/prompts";

function NewWorkspacePageContent() {
  const searchParams = useSearchParams();
  const [description, setDescription] = useState(searchParams.get("description") ?? "");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");

  return (
    <div>
      <PageHeader
        title="New Workspace"
        description="Describe the task, ticket, or feature. Claude will determine the task type, repositories, and workspace name automatically."
      />

      <InitOperation>
        {({ start, started }) => (
          <div className="w-full space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium">
                  Task Description
                </label>
                <SnippetPicker
                  onInsert={(content) =>
                    setDescription((prev) =>
                      prev.trim() ? `${prev}\n\n${content}` : content,
                    )
                  }
                  disabled={started}
                />
              </div>
              <textarea
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
              <label className="mb-1 block text-xs font-medium">
                Interaction Level
              </label>
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
                description={description}
                interactionLevel={interactionLevel}
                start={start}
              />
            )}
          </div>
        )}
      </InitOperation>
    </div>
  );
}

export default function NewWorkspacePage() {
  return (
    <Suspense>
      <NewWorkspacePageContent />
    </Suspense>
  );
}
