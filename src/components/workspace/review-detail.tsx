"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useReviewDetail, useWorkspace } from "@/hooks/use-workspace";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { cardVariants } from "../shared/containers/card";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { Textarea } from "../shared/forms/textarea";
import { InteractionLevelSelector } from "../shared/forms/interaction-level-selector";
import { StatusText } from "../shared/feedback/status-text";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import type { InteractionLevel } from "@/types/prompts";

export function ReviewDetail({
  workspaceName,
  timestamp,
}: {
  workspaceName: string;
  timestamp: string;
}) {
  const [instruction, setInstruction] = useState("");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const { summary, files, isLoading } = useReviewDetail(
    workspaceName,
    timestamp
  );
  const { workspace } = useWorkspace(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();
  const isRunning = isWorkspaceRunning(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);

  if (isLoading) {
    return <StatusText>Loading...</StatusText>;
  }

  return (
    <div className="space-y-4">
      {workspace && (
        <Card variant="dashed">
          <h3 className="mb-2 text-sm font-medium">Create TODO</h3>
          <div className="space-y-2">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Focus on security issues only (leave empty for all)"
              disabled={isRunning}
              rows={2}
            />
            <div className="flex items-center justify-end gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Interaction:</span>
                <InteractionLevelSelector
                  value={interactionLevel}
                  onChange={setInteractionLevel}
                  disabled={isRunning}
                />
              </div>
              <Button
                onClick={() =>
                  startAndNavigate("create-todo", {
                    workspace: workspace.path,
                    reviewTimestamp: timestamp,
                    interactionLevel,
                    ...(instruction.trim() && {
                      instruction: instruction.trim(),
                    }),
                  })
                }
                disabled={isRunning}
              >
                Create TODO
              </Button>
            </div>
          </div>
        </Card>
      )}

      {summary && (
        <div>
          <div className="mb-2 flex items-center justify-end">
            <Link
              href={`/workspace/${encodeURIComponent(workspaceName)}/chat/interactive?reviewTimestamp=${timestamp}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <MessageSquare className="h-4 w-4" />
              Chat about this
            </Link>
          </div>
          <MarkdownRenderer content={summary} />
        </div>
      )}
      {files && files.length > 0 && (
        <div className="space-y-4">
          {files.map((f) => (
            <details key={f.name} className={cardVariants("flush")}>
              <summary className="cursor-pointer px-4 py-2 font-medium hover:bg-accent">
                {f.name}
              </summary>
              <div className="border-t px-4 py-3">
                <MarkdownRenderer content={f.content} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
