"use client";

import type { AskQuestion } from "@/types/claude";
import { useAskInput } from "@/hooks/use-ask-input";
import { Button } from "../../shared/buttons/button";
import { Input } from "../../shared/forms/input";
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
  const {
    submitting,
    dismissed,
    freeTexts,
    singleSelected,
    multiSelected,
    setFreeText,
    handleSingleSelect,
    toggleMultiSelect,
    handleSubmit,
    canSubmit,
  } = useAskInput({ operationId, toolUseId, questions });

  if (dismissed) return null;

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
                <Input
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
                  className="w-full"
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
