"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useArtifactFile, useReviewDetail, useWorkspace } from "@/hooks/use-workspace";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { cardVariants } from "../shared/containers/card";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { Textarea } from "../shared/forms/textarea";
import { InteractionLevelSelector } from "../shared/forms/interaction-level-selector";
import { StatusText } from "../shared/feedback/status-text";
import { ReviewFindingsList } from "./review-findings-list";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { ARTIFACT_MAX_BYTES } from "@/lib/constants";
import { formatBytes } from "@/lib/utils";
import type { InteractionLevel } from "@/types/prompts";
import type { ReviewFileRef } from "@/types/workspace";

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

      <ReviewFindingsList workspaceName={workspaceName} timestamp={timestamp} />

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
            <ReviewReportSection
              key={f.name}
              workspaceName={workspaceName}
              timestamp={timestamp}
              file={f}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One per-repo report, read when it is opened rather than with the session.
 *
 * A cycle writes a `REVIEW-*`, `VERIFY-*` and `CONSTRAINTS-*` per repository, so
 * a session's reports run to hundreds of kilobytes — all of it fetched, parsed
 * and rendered as markdown to show a row of collapsed headings. The body reads
 * through the artifacts file route, which is the same reader the Artifacts tab
 * uses and bounds the read.
 *
 * `open` is React's, and the summary's own toggle is prevented: the body is
 * mounted only while open, and that is what makes the read lazy.
 */
function ReviewReportSection({
  workspaceName,
  timestamp,
  file,
}: {
  workspaceName: string;
  timestamp: string;
  file: ReviewFileRef;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details open={isOpen} className={cardVariants("flush")}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setIsOpen((v) => !v);
        }}
        className="flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 font-medium hover:bg-accent"
      >
        <span className="min-w-0 break-all">{file.name}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          {formatBytes(file.size)}
        </span>
      </summary>
      {isOpen && (
        <div className="border-t px-4 py-3">
          <ReviewReportBody
            workspaceName={workspaceName}
            relPath={`reviews/${timestamp}/${file.name}`}
          />
        </div>
      )}
    </details>
  );
}

function ReviewReportBody({
  workspaceName,
  relPath,
}: {
  workspaceName: string;
  relPath: string;
}) {
  const { file, isLoading, error } = useArtifactFile(workspaceName, relPath);

  if (error || (!file && !isLoading)) {
    return (
      <StatusText>
        This report could not be read. A running review may have rewritten it.
      </StatusText>
    );
  }
  if (!file) return <StatusText>Loading...</StatusText>;
  if (file.kind === "binary") {
    return <StatusText>{formatBytes(file.size)} — not a text file.</StatusText>;
  }

  return (
    <>
      {file.truncated && (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing the first {formatBytes(ARTIFACT_MAX_BYTES)} of {formatBytes(file.size)}.
        </p>
      )}
      <MarkdownRenderer content={file.content} />
    </>
  );
}
