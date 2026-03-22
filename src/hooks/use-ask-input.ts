import { useState, useCallback, useMemo } from "react";
import type { AskQuestion } from "@/types/claude";

export function useAskInput({
  operationId,
  toolUseId,
  questions,
}: {
  operationId: string;
  toolUseId: string;
  questions: AskQuestion[];
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

  const canSubmit = useMemo(
    () => !submitting && buildAnswers() !== null,
    [submitting, buildAnswers]
  );

  return {
    submitting,
    freeTexts,
    singleSelected,
    multiSelected,
    setFreeText,
    handleSingleSelect,
    toggleMultiSelect,
    handleSubmit,
    canSubmit,
  };
}
