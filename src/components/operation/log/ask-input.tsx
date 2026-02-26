"use client";

import { useState, useCallback } from "react";
import type { AskQuestion } from "@/lib/parsers/stream";

export function AskInput({
  operationId,
  toolUseId,
  questions,
}: {
  operationId: string;
  toolUseId: string;
  questions: AskQuestion[];
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, Set<string>>
  >({});

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

  const handleOptionClick = useCallback(
    (questionText: string, label: string) => {
      submit({ [questionText]: label });
    },
    [submit]
  );

  const toggleOption = useCallback(
    (questionText: string, label: string) => {
      setSelectedOptions((prev) => {
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

  const handleMultiSelectSubmit = useCallback(
    (questionText: string) => {
      const selected = selectedOptions[questionText];
      if (!selected || selected.size === 0) return;
      submit({ [questionText]: Array.from(selected).join(", ") });
    },
    [selectedOptions, submit]
  );

  const handleFreeText = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!value.trim()) return;
      // Map free text to the first question
      const firstQuestion = questions[0]?.question ?? "";
      submit({ [firstQuestion]: value.trim() });
      setValue("");
    },
    [value, questions, submit]
  );

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
      <p className="mb-2 text-sm font-medium">Input required</p>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-3 last:mb-2">
          <p className="mb-1.5 text-sm">{q.question}</p>
          {q.options.length > 0 &&
            (q.multiSelect ? (
              <div className="space-y-1.5">
                {q.options.map((o, oi) => {
                  const checked =
                    selectedOptions[q.question]?.has(o.label) ?? false;
                  return (
                    <label
                      key={oi}
                      className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent"
                      title={o.description}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOption(q.question, o.label)}
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
                <button
                  onClick={() => handleMultiSelectSubmit(q.question)}
                  disabled={
                    submitting ||
                    !selectedOptions[q.question] ||
                    selectedOptions[q.question].size === 0
                  }
                  className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o, oi) => (
                  <button
                    key={oi}
                    onClick={() => handleOptionClick(q.question, o.label)}
                    disabled={submitting}
                    className="rounded-md border bg-background px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
                    title={o.description}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
        </div>
      ))}

      <form onSubmit={handleFreeText} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type a response..."
          disabled={submitting}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={!value.trim() || submitting}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
