"use client";

import { useState } from "react";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { Textarea } from "../shared/forms/textarea";
import { InteractionLevelSelector } from "../shared/forms/interaction-level-selector";
import type { SplitButtonItem } from "@/types/components";
import type { InteractionLevel } from "@/types/prompts";

export function UpdateForm({
  label,
  placeholder,
  onSubmit,
  disabled,
  batchItems,
}: {
  label: string;
  placeholder: string;
  onSubmit: (instruction: string, interactionLevel: InteractionLevel) => void;
  disabled: boolean;
  /** When provided, renders a SplitButton with batch dropdown items. */
  batchItems?: (instruction: string, interactionLevel: InteractionLevel) => SplitButtonItem[];
}) {
  const [instruction, setInstruction] = useState("");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");

  const handleSubmit = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    onSubmit(trimmed, interactionLevel);
    setInstruction("");
  };

  const items = batchItems ? batchItems(instruction, interactionLevel) : undefined;

  return (
    <div className="space-y-2">
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={disabled}
          onClick={() =>
            setInstruction(
              "Check the PR opened on the current branch using `gh pr list` and `gh pr view`, then review all review comments with `gh pr view --comments` and `gh api` for review threads. Identify any unresolved review comments and actionable feedback, and convert them into TODO items in the TODO file.",
            )
          }
        >
          Address PR Reviews
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Interaction:</span>
          <InteractionLevelSelector
            value={interactionLevel}
            onChange={setInteractionLevel}
            disabled={disabled}
          />
        </div>
        {items ? (
          <SplitButton
            label={label}
            onClick={handleSubmit}
            disabled={disabled || !instruction.trim()}
            items={items}
          />
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={disabled || !instruction.trim()}
          >
            {label}
          </Button>
        )}
      </div>
    </div>
  );
}
