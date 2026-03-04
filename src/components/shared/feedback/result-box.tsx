import { MarkdownRenderer } from "../content/markdown-renderer";

export function ResultBox({
  content,
  cost,
  duration,
}: {
  content: string;
  cost?: string;
  duration?: string;
}) {
  return (
    <div className="rounded-md bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
      <MarkdownRenderer content={content} />
      {(cost || duration) && (
        <div className="mt-1 text-xs opacity-70">
          {[cost, duration].filter(Boolean).join(" | ")}
        </div>
      )}
    </div>
  );
}
