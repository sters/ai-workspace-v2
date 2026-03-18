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
      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-1.5">
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
