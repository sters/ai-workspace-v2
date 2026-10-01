"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { MessageSquarePlus } from "lucide-react";
import { MonacoEditorLazy } from "./monaco-editor-lazy";
import {
  describeLineRange,
  hunkBody,
  mapHunkLines,
  type LineRangeDescription,
} from "@/lib/unified-diff";

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

const LINE_HEIGHT_PX = 18;
const ACTION_WIDTH_PX = 150;

/**
 * One file's diff, from its first hunk on, in a read-only editor.
 *
 * With `onSelectLines`, selecting text shows a button beside the selection that
 * hands the selected lines — whole lines, numbered on each side of the file —
 * to the caller.
 */
export function UnifiedDiffViewer({
  content,
  maxHeight = 480,
  height: fixedHeight,
  onSelectLines,
  selectionActionLabel = "Add to chat",
}: {
  content: string;
  /** Pixels, or any CSS length (`calc(100vh - 16rem)`) for a viewport-relative cap. */
  maxHeight?: number | string;
  /** Overrides the content-fitted height, for a viewer that fills a space whatever the diff's length. */
  height?: number | string;
  onSelectLines?: (range: LineRangeDescription) => void;
  selectionActionLabel?: string;
}) {
  const body = useMemo(() => hunkBody(content), [content]);
  const lines = useMemo(() => mapHunkLines(body), [body]);
  const contentHeight = Math.max(80, lines.length * LINE_HEIGHT_PX);
  const height =
    fixedHeight ??
    (typeof maxHeight === "number"
      ? Math.min(maxHeight, contentHeight)
      : `min(${contentHeight}px, ${maxHeight})`);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [action, setAction] = useState<{ top: number; left: number } | null>(null);

  const placeAction = useCallback(() => {
    const ed = editorRef.current;
    const selection = ed?.getSelection();
    if (!ed || !selection || selection.isEmpty()) {
      setAction(null);
      return;
    }
    const pos = ed.getScrolledVisiblePosition(selection.getEndPosition());
    const box = containerRef.current?.getBoundingClientRect();
    if (!pos || !box || pos.top < 0 || pos.top > box.height) {
      setAction(null);
      return;
    }
    setAction({
      top: Math.min(pos.top + pos.height + 2, box.height - 28),
      left: Math.max(0, Math.min(pos.left, box.width - ACTION_WIDTH_PX)),
    });
  }, []);

  const handleMount: OnMount = useCallback(
    (ed) => {
      editorRef.current = ed;
      if (!onSelectLines) return;
      ed.onDidChangeCursorSelection(placeAction);
      ed.onDidScrollChange(placeAction);
    },
    [onSelectLines, placeAction],
  );

  const addSelection = () => {
    const ed = editorRef.current;
    const selection = ed?.getSelection();
    if (!ed || !selection || selection.isEmpty() || !onSelectLines) return;
    // A drag that ends at the start of a line has not selected any of it.
    const endLine =
      selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
        ? selection.endLineNumber - 1
        : selection.endLineNumber;
    onSelectLines(describeLineRange(lines, selection.startLineNumber, endLine));
    const end = selection.getEndPosition();
    ed.setSelection({
      startLineNumber: end.lineNumber,
      startColumn: end.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    });
  };

  return (
    <div ref={containerRef} className="relative border-t border-border" style={{ height }}>
      <MonacoEditorLazy
        language={DIFF_LANG}
        value={body}
        theme={DIFF_THEME}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          readOnly: true,
          lineNumbers: "on",
          renderLineHighlight: "none",
          folding: false,
        }}
      />
      {action && onSelectLines && (
        <button
          type="button"
          // mousedown, not click: the editor would otherwise take focus first
          // and may collapse the selection before the click lands.
          onMouseDown={(e) => {
            e.preventDefault();
            addSelection();
          }}
          className="absolute z-10 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-md hover:bg-accent"
          style={{ top: action.top, left: action.left }}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {selectionActionLabel}
        </button>
      )}
    </div>
  );
}
