"use client";

import { useCallback } from "react";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { Spinner } from "@/components/shared/feedback/spinner";
import { MarkdownRenderer } from "@/components/shared/content/markdown-renderer";
import { useStreamingFetch } from "@/hooks/use-streaming-fetch";
import { extractAnswer } from "@/lib/parsers/stream";
import { useState } from "react";

export function QuickAsk({ workspaceName }: { workspaceName: string }) {
  const [question, setQuestion] = useState("");
  const { events, isRunning, error, run, cancel, reset } = useStreamingFetch();

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    await run("/api/operations/quick-ask", { workspace: workspaceName, question: q });
  }, [question, workspaceName, run]);

  const handleClear = useCallback(() => {
    setQuestion("");
    reset();
  }, [reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleAsk();
      }
    },
    [handleAsk],
  );

  const answer = !isRunning ? extractAnswer(events) : null;
  const hasResult = !isRunning && (answer || error);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder="Ask a question about this workspace..."
          className="flex-1"
        />
        <Button
          onClick={handleAsk}
          disabled={!question.trim() || isRunning}
        >
          Ask
        </Button>
        {(isRunning || hasResult) && (
          <Button
            variant="outline"
            onClick={isRunning ? cancel : handleClear}
          >
            {isRunning ? "Cancel" : "Clear"}
          </Button>
        )}
      </div>

      {isRunning && (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Spinner />
          Thinking...
        </div>
      )}

      {!isRunning && answer && (
        <div className="rounded-md border bg-muted/30 p-4">
          <MarkdownRenderer content={answer} />
        </div>
      )}

      {!isRunning && error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
