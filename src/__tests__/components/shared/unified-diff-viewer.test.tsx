import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DiffZone } from "@/components/shared/content/unified-diff-viewer";

/**
 * A stand-in for the Monaco editor that keeps only what the zones touch: the
 * view zones (the spacers between lines) and the overlay widgets over them.
 */
function fakeEditor() {
  const viewZones = new Map<string, { afterLineNumber: number }>();
  const overlays = new Set<string>();
  let nextId = 0;
  const editor = {
    changeViewZones: (cb: (accessor: unknown) => void) =>
      cb({
        addZone: (zone: { afterLineNumber: number }) => {
          const id = String(++nextId);
          viewZones.set(id, zone);
          return id;
        },
        removeZone: (id: string) => viewZones.delete(id),
        layoutZone: () => {},
      }),
    addOverlayWidget: (w: { getId: () => string }) => overlays.add(w.getId()),
    removeOverlayWidget: (w: { getId: () => string }) => overlays.delete(w.getId()),
    createDecorationsCollection: () => ({ clear: () => {} }),
    getLayoutInfo: () => ({ contentLeft: 40, contentWidth: 600, verticalScrollbarWidth: 10 }),
    onDidLayoutChange: () => ({ dispose: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    onDidScrollChange: () => ({ dispose: () => {} }),
  };
  return { editor, viewZones, overlays };
}

let current = fakeEditor();

vi.mock("@/components/shared/content/monaco-editor-lazy", () => ({
  MonacoEditorLazy: ({ onMount }: { onMount: (ed: unknown) => void }) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => onMount(current.editor), []);
    return null;
  },
}));

import { UnifiedDiffViewer } from "@/components/shared/content/unified-diff-viewer";

const DIFF = "@@ -1,2 +1,3 @@\n a\n+b\n+c\n";

function zone(key: string, toLine: number): DiffZone {
  return { key, fromLine: toLine, toLine, content: <p>{key}</p> };
}

describe("UnifiedDiffViewer zones", () => {
  it("removes a zone's spacer along with its content, so no blank is left between the lines", () => {
    current = fakeEditor();
    const { rerender } = render(
      <UnifiedDiffViewer content={DIFF} onSelectLines={() => {}} zones={[zone("draft", 3)]} />,
    );
    expect(current.viewZones.size).toBe(1);

    // The draft becomes a comment on the same lines.
    rerender(<UnifiedDiffViewer content={DIFF} onSelectLines={() => {}} zones={[zone("c1", 3)]} />);

    expect([...current.overlays]).toEqual(["aiw-diff-zone-c1"]);
    expect(current.viewZones.size).toBe(1);
  });

  it("moves a zone's spacer when its lines move", () => {
    current = fakeEditor();
    const { rerender } = render(<UnifiedDiffViewer content={DIFF} zones={[zone("c1", 2)]} />);
    rerender(<UnifiedDiffViewer content={DIFF} zones={[zone("c1", 4)]} />);

    expect([...current.viewZones.values()].map((z) => z.afterLineNumber)).toEqual([4]);
    expect(current.overlays.size).toBe(1);
  });
});
