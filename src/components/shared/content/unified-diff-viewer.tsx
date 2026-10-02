"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { MessageSquarePlus } from "lucide-react";
import { MonacoEditorLazy } from "./monaco-editor-lazy";
import {
  describeLineRange,
  diffGutterLabels,
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
const ZONE_MAX_WIDTH_PX = 720;

/**
 * Content shown between the diff's lines, under `toLine`, the way a review
 * comment sits under the lines it is about. `fromLine..toLine` (editor lines,
 * 1-based) are marked in the gutter.
 */
export interface DiffZone {
  key: string;
  fromLine: number;
  toLine: number;
  content: ReactNode;
}

/**
 * A zone is two things, the way Monaco's own peek widgets are: a view zone,
 * which is only an empty spacer between the lines, and an overlay widget kept
 * over it, which holds the content. The content cannot go in the view zone
 * itself — Monaco layers view zones beneath the text, so the lines take every
 * click aimed at them.
 */
interface MountedZone {
  zoneId: string | null;
  afterLine: number;
  zone: editor.IViewZone | null;
  widget: editor.IOverlayWidget;
}

/**
 * One file's diff, from its first hunk on, in a read-only editor, with the
 * gutter showing each line's old and new file line numbers.
 *
 * With `onSelectLines`, selecting text shows a button beside the selection that
 * hands the selected lines — whole lines, numbered on each side of the file —
 * to the caller. `zones` renders content inline between lines.
 */
export function UnifiedDiffViewer({
  content,
  maxHeight = 480,
  height: fixedHeight,
  onSelectLines,
  selectionActionLabel = "Comment",
  zones,
}: {
  content: string;
  /** Pixels, or any CSS length (`calc(100vh - 16rem)`) for a viewport-relative cap. */
  maxHeight?: number | string;
  /** Overrides the content-fitted height, for a viewer that fills a space whatever the diff's length. */
  height?: number | string;
  onSelectLines?: (range: LineRangeDescription) => void;
  selectionActionLabel?: string;
  zones?: DiffZone[];
}) {
  const body = useMemo(() => hunkBody(content), [content]);
  const lines = useMemo(() => mapHunkLines(body), [body]);
  // The editor would number its own lines from 1; the reader wants the file's.
  const options = useMemo(() => {
    const { labels, chars } = diffGutterLabels(lines);
    return {
      readOnly: true,
      lineNumbers: (n: number) => labels[n - 1] ?? "",
      lineNumbersMinChars: chars,
      renderLineHighlight: "none" as const,
      folding: false,
    };
  }, [lines]);
  const contentHeight = Math.max(80, lines.length * LINE_HEIGHT_PX);
  const height =
    fixedHeight ??
    (typeof maxHeight === "number"
      ? Math.min(maxHeight, contentHeight)
      : `min(${contentHeight}px, ${maxHeight})`);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // State as well as the ref, so the zone effect runs again once the editor exists.
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null);
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
      setMountedEditor(ed);
      if (!onSelectLines) return;
      ed.onDidChangeCursorSelection(placeAction);
      ed.onDidScrollChange(placeAction);
    },
    [onSelectLines, placeAction],
  );

  const contentArea = useEditorContentArea(mountedEditor);
  const zoneNodes = useRef(new Map<string, HTMLDivElement>());
  const mountedZones = useRef(new Map<string, MountedZone>());
  const nodeFor = (key: string) => {
    let node = zoneNodes.current.get(key);
    if (!node) {
      node = document.createElement("div");
      node.style.top = "-1000px";
      zoneNodes.current.set(key, node);
    }
    return node;
  };

  // Layout, not passive: a zone's content (a comment box focusing itself, say)
  // runs its own effects after this, and expects to be in the document by then.
  const zoneLayout = (zones ?? []).map((z) => `${z.key}:${z.fromLine}:${z.toLine}`).join(",");
  useLayoutEffect(() => {
    const ed = mountedEditor;
    if (!ed) return;
    const wanted = new Map((zones ?? []).map((z) => [z.key, z]));

    ed.changeViewZones((accessor) => {
      for (const [key, mounted] of mountedZones.current) {
        if (wanted.has(key)) continue;
        if (mounted.zoneId) accessor.removeZone(mounted.zoneId);
        ed.removeOverlayWidget(mounted.widget);
        mountedZones.current.delete(key);
        zoneNodes.current.delete(key);
      }
      for (const [key, z] of wanted) {
        let mounted = mountedZones.current.get(key);
        if (mounted?.zoneId && mounted.afterLine === z.toLine) continue;
        if (!mounted) {
          const node = nodeFor(key);
          const widget: editor.IOverlayWidget = {
            getId: () => `aiw-diff-zone-${key}`,
            getDomNode: () => node,
            getPosition: () => null,
          };
          ed.addOverlayWidget(widget);
          mounted = { zoneId: null, afterLine: z.toLine, zone: null, widget };
          mountedZones.current.set(key, mounted);
        }
        if (mounted.zoneId) accessor.removeZone(mounted.zoneId);
        const node = nodeFor(key);
        const zone: editor.IViewZone = {
          afterLineNumber: z.toLine,
          heightInPx: mounted.zone?.heightInPx ?? 80,
          domNode: document.createElement("div"),
          onDomNodeTop: (top) => {
            node.style.top = `${top}px`;
          },
        };
        mounted.zone = zone;
        mounted.afterLine = z.toLine;
        mounted.zoneId = accessor.addZone(zone);
      }
    });

    const marks = ed.createDecorationsCollection(
      (zones ?? []).map((z) => ({
        range: { startLineNumber: z.fromLine, startColumn: 1, endLineNumber: z.toLine, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: "aiw-diff-zone-lines" },
      })),
    );
    return () => marks.clear();
    // `zoneLayout` stands for `zones`' placement; their content re-renders through the portals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedEditor, zoneLayout]);

  const resizeZone = useCallback((key: string, height: number) => {
    const ed = editorRef.current;
    const mounted = mountedZones.current.get(key);
    if (!ed || !mounted?.zone || !mounted.zoneId || mounted.zone.heightInPx === height) return;
    mounted.zone.heightInPx = height;
    const zoneId = mounted.zoneId;
    ed.changeViewZones((accessor) => accessor.layoutZone(zoneId));
  }, []);

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
        options={options}
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
      {(zones ?? []).map((z) =>
        createPortal(
          <ZoneBody zoneKey={z.key} area={contentArea} onResize={resizeZone}>
            {z.content}
          </ZoneBody>,
          nodeFor(z.key),
          z.key,
        ),
      )}
    </div>
  );
}

/** Where the editor's text sits horizontally, which a zone's content lines up with. */
function useEditorContentArea(
  ed: editor.IStandaloneCodeEditor | null,
): { left: number; width: number } | null {
  const [area, setArea] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!ed) return;
    const read = () => {
      const layout = ed.getLayoutInfo();
      setArea({ left: layout.contentLeft, width: layout.contentWidth - layout.verticalScrollbarWidth });
    };
    read();
    const sub = ed.onDidLayoutChange(read);
    return () => sub.dispose();
  }, [ed]);
  return area;
}

function ZoneBody({
  zoneKey,
  area,
  onResize,
  children,
}: {
  zoneKey: string;
  area: { left: number; width: number } | null;
  onResize: (key: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onResize(zoneKey, node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [zoneKey, onResize]);

  return (
    <div
      ref={ref}
      className="py-1.5 pr-3 font-sans"
      style={
        area
          ? { marginLeft: area.left, width: Math.min(ZONE_MAX_WIDTH_PX, area.width - 12) }
          : undefined
      }
    >
      {children}
    </div>
  );
}
