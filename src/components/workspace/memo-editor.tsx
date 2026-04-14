"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { MonacoEditorLazy } from "@/components/shared/content/monaco-editor-lazy";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { Spinner } from "@/components/shared/feedback/spinner";
import { useMemoContent } from "@/hooks/use-workspace";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useStreamingFetch } from "@/hooks/use-streaming-fetch";
import { extractAnswer } from "@/lib/parsers/stream";
import { postJson } from "@/lib/api";

const AUTO_SAVE_INTERVAL_MS = 60_000;

/** Module-level cache to survive tab switches (component remount). */
const contentCache = new Map<string, string>();

export function MemoEditor({
  workspaceName,
  workspacePath,
}: {
  workspaceName: string;
  workspacePath: string;
}) {
  const { content: initialContent, isLoading } = useMemoContent(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const { events, isRunning, run, cancel, reset } = useStreamingFetch();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const isDirty = useRef(false);
  const isSaving = useRef(false);
  const contentRef = useRef("");
  const initializedRef = useRef(false);
  const pendingPlaceholderRef = useRef<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [hasSelection, setHasSelection] = useState(false);
  const [askInstruction, setAskInstruction] = useState("");

  // Save function
  const saveMemo = useCallback(async () => {
    if (!isDirty.current || isSaving.current) return;
    isSaving.current = true;
    setSaveStatus("saving");
    try {
      await postJson(`/api/workspaces/${encodeURIComponent(workspaceName)}/memo`, {
        content: contentRef.current,
      });
      isDirty.current = false;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setSaveStatus("idle");
    } finally {
      isSaving.current = false;
    }
  }, [workspaceName]);

  // Set initial content: prefer module cache (survives tab switch), fall back to API
  useEffect(() => {
    if (!initializedRef.current && !isLoading) {
      const cached = contentCache.get(workspaceName);
      contentRef.current = cached ?? initialContent;
      if (cached != null && editorRef.current) {
        editorRef.current.setValue(cached);
      }
      initializedRef.current = true;
    }
  }, [initialContent, isLoading, workspaceName]);

  // Auto-save interval + cleanup save on unmount/navigation
  useEffect(() => {
    const interval = setInterval(() => {
      saveMemo();
    }, AUTO_SAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      // Fire-and-forget save on navigation
      if (isDirty.current) {
        const body = JSON.stringify({ content: contentRef.current });
        const url = `/api/workspaces/${encodeURIComponent(workspaceName)}/memo`;
        try {
          navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        } catch {
          // fallback: best-effort
        }
      }
    };
  }, [saveMemo, workspaceName]);

  // beforeunload save
  useEffect(() => {
    const handler = () => {
      if (isDirty.current) {
        const body = JSON.stringify({ content: contentRef.current });
        const url = `/api/workspaces/${encodeURIComponent(workspaceName)}/memo`;
        try {
          navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [workspaceName]);

  // Replace placeholder when Claude streaming completes
  useEffect(() => {
    if (!isRunning && pendingPlaceholderRef.current && events.length > 0) {
      const answer = extractAnswer(events);
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (answer && editor && model) {
        const placeholder = `{TO_BE_REPLACED:${pendingPlaceholderRef.current}}`;
        const matches = model.findMatches(placeholder, false, false, true, null, false);
        if (matches.length > 0) {
          const range = matches[0].range;
          editor.executeEdits("memo-ask-claude", [
            { range, text: answer },
          ]);
          contentRef.current = model.getValue();
          contentCache.set(workspaceName, contentRef.current);
          isDirty.current = true;
        }
      }
      pendingPlaceholderRef.current = null;
      reset();
    }
  }, [isRunning, events, reset, workspaceName]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    contentRef.current = value ?? "";
    contentCache.set(workspaceName, contentRef.current);
    isDirty.current = true;
  }, [workspaceName]);

  const handleEditorReady = useCallback((ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    ed.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      setHasSelection(!sel.isEmpty());
    });
  }, []);

  const getSelectedText = useCallback((): string | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return null;
    return editor.getModel()?.getValueInRange(selection) ?? null;
  }, []);

  const buildPrompt = useCallback((selectedText: string): string => {
    const extra = askInstruction.trim();
    return extra ? `${extra}\n\n---\n${selectedText}` : selectedText;
  }, [askInstruction]);

  const clearInputs = useCallback(() => {
    setAskInstruction("");
    editorRef.current?.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
  }, []);

  // Update TODO button handler
  const handleUpdateTodo = useCallback(async () => {
    const text = getSelectedText();
    if (!text) return;
    const instruction = buildPrompt(text);
    clearInputs();
    await saveMemo();
    startAndNavigate("update-todo", {
      workspace: workspacePath,
      instruction,
      interactionLevel: "mid",
    });
  }, [getSelectedText, buildPrompt, clearInputs, saveMemo, startAndNavigate, workspacePath]);

  // Ask Claude button handler
  const handleAskClaude = useCallback(() => {
    const text = getSelectedText();
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!text || !editor || !model) return;

    const question = buildPrompt(text);

    const uuid = crypto.randomUUID();
    const placeholder = `{TO_BE_REPLACED:${uuid}}`;
    const selection = editor.getSelection();
    if (!selection) return;

    // Insert placeholder below the selection
    const endLine = selection.endLineNumber;
    const endCol = model.getLineMaxColumn(endLine);
    editor.executeEdits("memo-ask-claude", [
      {
        range: {
          startLineNumber: endLine,
          startColumn: endCol,
          endLineNumber: endLine,
          endColumn: endCol,
        },
        text: `\n\n${placeholder}\n`,
      },
    ]);
    contentRef.current = model.getValue();
    isDirty.current = true;

    pendingPlaceholderRef.current = uuid;
    clearInputs();
    run("/api/operations/quick-ask", {
      workspace: workspaceName,
      question,
    });
  }, [getSelectedText, buildPrompt, clearInputs, workspaceName, run]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner /> Loading memo...
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 320px)", minHeight: "400px" }}>
      {/* Toolbar */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">For selected text:</span>
        <Input
          type="text"
          value={askInstruction}
          onChange={(e) => setAskInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && hasSelection && !isRunning) {
              e.preventDefault();
              handleAskClaude();
            }
          }}
          disabled={!hasSelection || isRunning}
          placeholder="Additional instruction (optional)"
          className="w-64 px-2 py-1 text-xs"
        />
        <Button
          variant="outline"
          onClick={handleUpdateTodo}
          disabled={!hasSelection}
        >
          Update TODO
        </Button>
        <Button
          variant="outline"
          onClick={isRunning ? cancel : handleAskClaude}
          disabled={!isRunning && !hasSelection}
        >
          {isRunning ? (
            <span className="flex items-center gap-1">
              <Spinner /> Cancel
            </span>
          ) : (
            "Ask Claude"
          )}
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && "Saved"}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 rounded-md border">
        <MonacoEditorLazy
          language="markdown"
          defaultValue={contentCache.get(workspaceName) ?? initialContent}
          onChange={handleEditorChange}
          onEditorReady={handleEditorReady}
          options={{
            wordWrap: "on",
            lineNumbers: "on",
            renderLineHighlight: "none",
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
