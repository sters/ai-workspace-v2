"use client";

import { useState } from "react";
import type { ReviewSession } from "@/types/workspace";
import { useReviewDetail } from "@/hooks/use-workspace";
import { MarkdownRenderer } from "../shared/markdown-renderer";
import { ClaudeOperation } from "../operation/claude-operation";

export function ReviewViewer({
  workspaceName,
  workspacePath,
  reviews,
}: {
  workspaceName: string;
  workspacePath: string;
  reviews: ReviewSession[];
}) {
  const [selected, setSelected] = useState<string | null>(
    reviews[0]?.timestamp ?? null
  );
  const [instruction, setInstruction] = useState("");
  const { summary, files, isLoading } = useReviewDetail(
    workspaceName,
    selected
  );

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No reviews found.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {reviews.map((r) => (
          <button
            key={r.timestamp}
            onClick={() => setSelected(r.timestamp)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              selected === r.timestamp
                ? "border-primary bg-primary/10"
                : "hover:bg-accent"
            }`}
          >
            <div className="font-medium">{formatTimestamp(r.timestamp)}</div>
            <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
              <span>{r.repos} repos</span>
              {r.critical > 0 && (
                <span className="text-red-500">{r.critical} critical</span>
              )}
              <span>{r.warnings} warn</span>
              <span>{r.suggestions} suggest</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-4">
          <ClaudeOperation
            storageKey={`review-todo:${workspacePath}:${selected}`}
            workspace={workspacePath}
            vertical
          >
            {({ start, isRunning }) => (
              <div className="rounded-lg border border-dashed p-4">
                <h3 className="mb-2 text-sm font-medium">Create TODO</h3>
                <div className="space-y-2">
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="e.g. Focus on security issues only (leave empty for all)"
                    disabled={isRunning}
                    rows={2}
                    className="w-full min-h-[2lh] resize-y rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:opacity-50"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() =>
                        start("create-todo", {
                          workspace: workspacePath,
                          reviewTimestamp: selected,
                          ...(instruction.trim() && { instruction: instruction.trim() }),
                        })
                      }
                      disabled={isRunning}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Create TODO
                    </button>
                  </div>
                </div>
              </div>
            )}
          </ClaudeOperation>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              {summary && <MarkdownRenderer content={summary} />}
              {files && files.length > 0 && (
                <div className="space-y-4">
                  {files.map((f) => (
                    <details key={f.name} className="rounded-lg border">
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ts: string): string {
  // Format: "20260214-235920" -> "2026-02-14 23:59:20"
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}
