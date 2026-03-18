"use client";

import type { InteractionLevel } from "@/types/prompts";

const INTERACTION_LEVELS: { value: InteractionLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "mid", label: "Mid" },
  { value: "high", label: "High" },
];

export function InteractionLevelSelector({
  value,
  onChange,
  disabled,
}: {
  value: InteractionLevel;
  onChange: (level: InteractionLevel) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {INTERACTION_LEVELS.map(({ value: level, label }) => (
        <button
          key={level}
          onClick={() => onChange(level)}
          disabled={disabled}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            value === level
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
