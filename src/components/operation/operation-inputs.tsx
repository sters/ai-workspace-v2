"use client";

/** Labels for operation input keys. */
const INPUT_LABELS: Record<string, string> = {
  instruction: "Instruction",
  description: "Description",
  reviewTimestamp: "Review",
  mode: "Mode",
  startWith: "Start with",
  draft: "Draft PR",
  repository: "Repository",
  interactionLevel: "Interaction Level",
};

/** Collapsible display for user-provided operation inputs. */
export function OperationInputs({ inputs }: { inputs: Record<string, string> }) {
  return (
    <details className="rounded-md border text-sm">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 select-none">
        Inputs
      </summary>
      <div className="border-t px-3 py-2 space-y-1">
        {Object.entries(inputs).map(([key, value]) => (
          <div key={key}>
            <span className="text-xs font-medium text-muted-foreground">
              {INPUT_LABELS[key] ?? key}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">{value}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
