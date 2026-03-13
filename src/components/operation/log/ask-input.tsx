"use client";

import { useState, useCallback } from "react";
import type { AskQuestion } from "@/types/claude";
import { Button } from "../../shared/buttons/button";
import { Callout } from "../../shared/containers/callout";
import { MarkdownRenderer } from "../../shared/content/markdown-renderer";

export function AskInput({
  operationId,
  toolUseId,
  questions,
  allowFreeText = true,
}: {
  operationId: string;
  toolUseId: string;
  questions: AskQuestion[];
  allowFreeText?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  // Free text per question
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({});
  // Single-select: question → selected label
  const [singleSelected, setSingleSelected] = useState<Record<string, string>>({});
  // Multi-select: question → set of selected labels
  const [multiSelected, setMultiSelected] = useState<Record<string, Set<string>>>({});

  const submit = useCallback(
    async (answers: Record<string, string>) => {
      setSubmitting(true);
      try {
        await fetch("/api/operations/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId, toolUseId, answers }),
        });
      } catch {
        // ignore
      } finally {
        setSubmitting(false);
      }
    },
    [operationId, toolUseId]
  );

  const setFreeText = useCallback(
    (questionText: string, value: string, isMultiSelect: boolean) => {
      setFreeTexts((prev) => ({ ...prev, [questionText]: value }));
      // For single-select, free text replaces the selection
      if (value && !isMultiSelect) {
        setSingleSelected((prev) => { const next = { ...prev }; delete next[questionText]; return next; });
      }
    },
    []
  );

  const handleSingleSelect = useCallback(
    (questionText: string, label: string) => {
      setSingleSelected((prev) => ({ ...prev, [questionText]: label }));
      // Clear free text for this question when an option is selected
      setFreeTexts((prev) => ({ ...prev, [questionText]: "" }));
    },
    []
  );

  const toggleMultiSelect = useCallback(
    (questionText: string, label: string) => {
      setMultiSelected((prev) => {
        const current = new Set(prev[questionText] ?? []);
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
        return { ...prev, [questionText]: current };
      });
    },
    []
  );

  const buildAnswers = useCallback((): Record<string, string> | null => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const ft = freeTexts[q.question]?.trim();
      if (q.options.length > 0 && q.multiSelect) {
        // Multi-select: combine checked options + free text
        const parts: string[] = [];
        const selected = multiSelected[q.question];
        if (selected && selected.size > 0) {
          parts.push(...Array.from(selected));
        }
        if (ft) parts.push(ft);
        if (parts.length === 0) return null;
        answers[q.question] = parts.join(", ");
      } else if (ft) {
        // Single-select / no options: free text overrides
        answers[q.question] = ft;
      } else if (q.options.length > 0) {
        const selected = singleSelected[q.question];
        if (!selected) return null;
        answers[q.question] = selected;
      }
    }
    return Object.keys(answers).length > 0 ? answers : null;
  }, [questions, singleSelected, multiSelected, freeTexts]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const answers = buildAnswers();
      if (!answers) return;
      submit(answers);
      setFreeTexts({});
    },
    [buildAnswers, submit]
  );

  const canSubmit = !submitting && buildAnswers() !== null;

  return (
    <Callout variant="warning">
      <p className="mb-2 text-sm font-medium">Input required</p>

      <div className="divide-y divide-border">
        {questions.map((q, qi) => {
          const ft = freeTexts[q.question] ?? "";
          const hasOptions = q.options.length > 0;
          return (
            <div key={qi} className={`space-y-2 ${qi > 0 ? "pt-3" : ""} ${qi < questions.length - 1 ? "pb-3" : "pb-2"}`}>
              <div className="text-sm"><MarkdownRenderer content={q.question} /></div>
              {hasOptions &&
                (q.multiSelect ? (
                  <div className="space-y-1.5">
                    {q.options.map((o, oi) => {
                      const checked =
                        multiSelected[q.question]?.has(o.label) ?? false;
                      return (
                        <label
                          key={oi}
                          className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent"
                          title={o.description}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMultiSelect(q.question, o.label)}
                            disabled={submitting}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span>{o.label}</span>
                          {o.description && (
                            <span className="text-xs text-muted-foreground">
                              — {o.description}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o, oi) => {
                      const isSelected = singleSelected[q.question] === o.label && !ft;
                      return (
                        <button
                          key={oi}
                          onClick={() => handleSingleSelect(q.question, o.label)}
                          disabled={submitting}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                          title={o.description}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              {allowFreeText && (
                <input
                  type="text"
                  value={ft}
                  onChange={(e) => setFreeText(q.question, e.target.value, !!q.multiSelect)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder={hasOptions ? "Or type a response..." : "Type a response..."}
                  disabled={submitting}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
                  autoFocus={qi === 0 && !hasOptions}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-3 mt-1">
        <Button
          onClick={() => handleSubmit()}
          disabled={!canSubmit}
        >
          Send
        </Button>
      </div>
    </Callout>
  );
}
