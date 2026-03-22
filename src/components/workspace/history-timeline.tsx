"use client";

import { useState, useCallback, useEffect } from "react";
import type { HistoryEntry } from "@/types/workspace";
import { useHistory } from "@/hooks/use-workspace";
import { Button } from "@/components/shared/buttons/button";
import { MonacoEditorLazy } from "@/components/shared/content/monaco-editor-lazy";
import { StatusText } from "@/components/shared/feedback/status-text";
import type { BeforeMount } from "@monaco-editor/react";

const DIFF_THEME = "unified-diff-theme";
const DIFF_LANG = "unified-diff";
let themeRegistered = false;

const handleBeforeMount: BeforeMount = (monaco) => {
  if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === DIFF_LANG)) {
    monaco.languages.register({ id: DIFF_LANG });
    monaco.languages.setMonarchTokensProvider(DIFF_LANG, {
      tokenizer: {
        root: [
          [/^diff .*$/, "diff-meta"],
          [/^index .*$/, "diff-meta"],
          [/^---.*$/, "diff-meta"],
          [/^\+\+\+.*$/, "diff-meta"],
          [/^@@.*@@.*$/, "diff-hunk"],
          [/^\+.*$/, "diff-added"],
          [/^-.*$/, "diff-removed"],
        ],
      },
    });
  }

  if (!themeRegistered) {
    themeRegistered = true;
    monaco.editor.defineTheme(DIFF_THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "diff-added", foreground: "4EC969" },
        { token: "diff-removed", foreground: "F85149" },
        { token: "diff-hunk", foreground: "79C0FF" },
        { token: "diff-meta", foreground: "8B949E", fontStyle: "bold" },
      ],
      colors: {},
    });
  }
};

function CommitDiff({
  workspaceName,
  hash,
}: {
  workspaceName: string;
  hash: string;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceName)}/history/${encodeURIComponent(hash)}`,
      { signal: controller.signal }
    )
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data) => {
        setDiff(data.diff);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceName, hash]);

  if (loading) {
    return <StatusText className="py-2 text-xs">Loading diff...</StatusText>;
  }

  if (error || diff === null) {
    return <StatusText variant="error" className="py-2 text-xs">Failed to load diff.</StatusText>;
  }

  if (diff.trim() === "") {
    return <StatusText className="py-2 text-xs">No changes in this commit.</StatusText>;
  }

  return <DiffViewer diff={diff} />;
}

function DiffViewer({ diff }: { diff: string }) {
  const lineCount = diff.split("\n").length;
  const height = Math.min(384, Math.max(100, lineCount * 18));

  return (
    <div className="mt-2 rounded border border-border" style={{ height }}>
      <MonacoEditorLazy
        language={DIFF_LANG}
        value={diff}
        theme={DIFF_THEME}
        beforeMount={handleBeforeMount}
        options={{
          readOnly: true,
          lineNumbers: "on",
          renderLineHighlight: "none",
          folding: false,
        }}
      />
    </div>
  );
}

export function HistoryTimeline({ workspaceName }: { workspaceName: string }) {
  const { history, isLoading } = useHistory(workspaceName);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  const toggleDiff = useCallback((hash: string) => {
    setExpandedHash((prev) => (prev === hash ? null : hash));
  }, []);

  if (isLoading) {
    return <StatusText>Loading...</StatusText>;
  }

  if (history.length === 0) {
    return <StatusText>No history found.</StatusText>;
  }

  return (
    <div className="space-y-0">
      {history.map((entry: HistoryEntry) => (
        <div key={entry.hash} className="border-l-2 border-border py-2 pl-4">
          <Button
            variant="ghost-toggle"
            type="button"
            className="flex w-full cursor-pointer gap-3 text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
            onClick={() => toggleDiff(entry.hash)}
          >
            <div className="flex-1">
              <p className="text-sm">{entry.message}</p>
              <p className="text-xs text-muted-foreground">
                {entry.hash.slice(0, 7)} &middot;{" "}
                {new Date(entry.date).toLocaleString()}
              </p>
            </div>
            <span className="text-xs self-center">
              {expandedHash === entry.hash ? "\u25B2" : "\u25BC"}
            </span>
          </Button>
          {expandedHash === entry.hash && (
            <CommitDiff workspaceName={workspaceName} hash={entry.hash} />
          )}
        </div>
      ))}
    </div>
  );
}
