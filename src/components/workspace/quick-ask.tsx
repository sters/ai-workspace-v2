"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { Spinner } from "@/components/shared/feedback/spinner";
import { MarkdownRenderer } from "@/components/shared/content/markdown-renderer";
import { parseStreamEvent } from "@/lib/parsers/stream";
import type { OperationEvent } from "@/types/operation";

function extractAnswer(events: OperationEvent[]): string | null {
  for (const event of events) {
    if (event.type !== "output") continue;
    for (const entry of parseStreamEvent(event.data)) {
      if (entry.kind === "result" && entry.content) return entry.content;
    }
  }
  return null;
}

export function QuickAsk({ workspaceName }: { workspaceName: string }) {
  const [question, setQuestion] = useState("");
  const [events, setEvents] = useState<OperationEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q) return;

    setEvents([]);
    setError(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/operations/quick-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: workspaceName, question: q }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: OperationEvent = JSON.parse(line.slice(6));
            setEvents((prev) => [...prev, event]);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed");
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [question, workspaceName]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClear = useCallback(() => {
    setQuestion("");
    setEvents([]);
    setError(null);
  }, []);

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
            onClick={isRunning ? handleCancel : handleClear}
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
