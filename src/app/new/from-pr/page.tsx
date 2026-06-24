"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { InteractionLevelSelector } from "@/components/shared/forms/interaction-level-selector";
import type { InteractionLevel } from "@/types/prompts";

const FROM_PR_STORAGE_KEY = "init-from-pr";

/** Navigate to the workspace operations page once the workspace name is known. */
function AutoNavigate({ workspace, reset }: { workspace: string; reset: () => void }) {
  const router = useRouter();
  const navigated = useRef(false);
  useEffect(() => {
    if (navigated.current) return;
    navigated.current = true;
    reset();
    router.push(`/workspace/${encodeURIComponent(workspace)}/operations`);
  }, [router, workspace, reset]);
  return null;
}

function FromPrPageContent() {
  const searchParams = useSearchParams();
  const [prUrl, setPrUrl] = useState(searchParams.get("prUrl") ?? "");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const [todoInstruction, setTodoInstruction] = useState("");
  const [withReview, setWithReview] = useState(false);

  return (
    <div>
      <PageHeader
        title="New Workspace from PR"
        description="Paste a GitHub PR URL. Claude verifies the PR, identifies (and clones, if needed) the repository, names a workspace from the PR description, and checks out the PR branch as a worktree."
      />

      <ClaudeOperation storageKey={FROM_PR_STORAGE_KEY}>
        {({ start, reset, isRunning, workspace, status }) => {
          const started = isRunning || status === "completed" || status === "failed";
          const trimmed = prUrl.trim();
          return (
            <>
              <div className="w-full space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium">PR URL</label>
                  <input
                    type="text"
                    value={prUrl}
                    onChange={(e) => setPrUrl(e.target.value)}
                    placeholder="https://github.com/org/repo/pull/123"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                    autoFocus
                    disabled={started}
                  />
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
                        ? "Asks about important unknowns while drafting the README."
                        : "Confirms scope and details while drafting the README."}
                  </p>
                </div>

                <fieldset className="space-y-3" disabled={started}>
                  <legend className="mb-1 text-xs font-medium">After setup (optional)</legend>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Create TODO</label>
                    <textarea
                      value={todoInstruction}
                      onChange={(e) => setTodoInstruction(e.target.value)}
                      placeholder={"Describe what TODOs to plan and the AI will decide. Leave empty to skip.\ne.g., レビュー指摘の対応方針をTODOにして\ne.g., Plan TODOs to add tests for the changed endpoints"}
                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                      rows={3}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      When provided, TODO planning runs after the worktree is created, guided by this instruction.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={withReview}
                      onChange={(e) => setWithReview(e.target.checked)}
                    />
                    Run review (review the PR branch after setup)
                  </label>
                </fieldset>

                {!started && (
                  <Button
                    onClick={() => {
                      if (!trimmed) return;
                      start("init-from-pr", {
                        prUrl: trimmed,
                        interactionLevel,
                        ...(todoInstruction.trim()
                          ? { todoInstruction: todoInstruction.trim() }
                          : {}),
                        ...(withReview ? { withReview: "true" } : {}),
                      });
                    }}
                    disabled={!trimmed}
                  >
                    Create workspace from PR
                  </Button>
                )}
              </div>

              {workspace && <AutoNavigate workspace={workspace} reset={reset} />}
            </>
          );
        }}
      </ClaudeOperation>
    </div>
  );
}

export default function FromPrPage() {
  return (
    <Suspense>
      <FromPrPageContent />
    </Suspense>
  );
}
