"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import { buttonVariants } from "@/components/shared/buttons/button";
import { Callout } from "@/components/shared/containers/callout";
import { PageHeader } from "@/components/shared/feedback/page-header";
import type { InteractionLevel } from "@/types/prompts";

export default function NewWorkspacePage() {
  const [description, setDescription] = useState("");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");

  return (
    <div>
      <PageHeader
        title="New Workspace"
        description="Describe the task, ticket, or feature. Claude will determine the task type, repositories, and workspace name automatically."
      />

      <ClaudeOperation storageKey="init">
        {({ start, isRunning, workspace, status }) => {
          const started = isRunning || status === "completed" || status === "failed";
          return (
          <div className="w-full space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Task Description
              </label>
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
              <div className="flex gap-1">
                {(["low", "mid", "high"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setInteractionLevel(level)}
                    disabled={started}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      interactionLevel === level
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {level === "low" ? "Low — Autonomous" : level === "mid" ? "Mid — Balanced" : "High — Collaborative"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {interactionLevel === "low"
                  ? "AI decides autonomously. Asks only when critical info is missing."
                  : interactionLevel === "mid"
                    ? "Asks about important unknowns like missing repositories."
                    : "Confirms scope, approach, and requirements. Adds checkpoints during TODO planning."}
              </p>
            </div>

            {!isRunning && status !== "completed" && (
              <SplitButton
                label="Initialize"
                onClick={() => {
                  if (!description.trim()) return;
                  start("init", { description: description.trim(), interactionLevel });
                }}
                disabled={!description.trim()}
                items={[
                  {
                    label: "Init \u2192 Execute \u2192 Review",
                    onClick: () => {
                      if (!description.trim()) return;
                      start("batch", {
                        startWith: "init",
                        mode: "execute-review",
                        description: description.trim(),
                        interactionLevel,
                      });
                    },
                  },
                  {
                    label: "Init \u2192 Execute \u2192 PR",
                    onClick: () => {
                      if (!description.trim()) return;
                      start("batch", {
                        startWith: "init",
                        mode: "execute-pr",
                        description: description.trim(),
                        interactionLevel,
                      });
                    },
                  },
                  {
                    label: "Init \u2192 Execute \u2192 Review \u2192 PR (gated)",
                    onClick: () => {
                      if (!description.trim()) return;
                      start("batch", {
                        startWith: "init",
                        mode: "execute-review-pr-gated",
                        description: description.trim(),
                        interactionLevel,
                      });
                    },
                  },
                  {
                    label: "Init \u2192 Execute \u2192 Review \u2192 PR",
                    onClick: () => {
                      if (!description.trim()) return;
                      start("batch", {
                        startWith: "init",
                        mode: "execute-review-pr",
                        description: description.trim(),
                        interactionLevel,
                      });
                    },
                  },
                ]}
              />
            )}
            {status === "completed" && workspace && (
              <InitNextActions workspace={workspace} />
            )}
          </div>
          );
        }}
      </ClaudeOperation>
    </div>
  );
}

function InitNextActions({ workspace }: { workspace: string }) {
  const router = useRouter();
  const wsEncoded = encodeURIComponent(workspace);

  return (
    <Callout variant="info">
      <p className="mb-2 text-sm font-medium text-foreground">Next steps</p>
      <div className="flex flex-wrap gap-2">
        <SplitButton
          label="Execute"
          onClick={() =>
            router.push(`/workspace/${wsEncoded}?action=execute`)
          }
          items={[
            {
              label: "Execute \u2192 Review",
              onClick: () =>
                router.push(
                  `/workspace/${wsEncoded}?action=batch&startWith=execute&mode=execute-review`,
                ),
            },
            {
              label: "Execute \u2192 PR",
              onClick: () =>
                router.push(
                  `/workspace/${wsEncoded}?action=batch&startWith=execute&mode=execute-pr`,
                ),
            },
            {
              label: "Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                router.push(
                  `/workspace/${wsEncoded}?action=batch&startWith=execute&mode=execute-review-pr-gated`,
                ),
            },
            {
              label: "Execute \u2192 Review \u2192 PR",
              onClick: () =>
                router.push(
                  `/workspace/${wsEncoded}?action=batch&startWith=execute&mode=execute-review-pr`,
                ),
            },
          ]}
        />
        <Link
          href={`/workspace/${wsEncoded}`}
          className={buttonVariants("outline", "bg-background px-3 py-1.5 text-sm text-foreground")}
        >
          View Workspace
        </Link>
      </div>
    </Callout>
  );
}
