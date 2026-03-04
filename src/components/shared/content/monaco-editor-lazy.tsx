"use client";

import Editor, { type EditorProps, type OnMount } from "@monaco-editor/react";
import { useCallback } from "react";
import type { editor } from "monaco-editor";

export type MonacoEditorLazyProps = EditorProps & {
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
};

export function MonacoEditorLazy({
  onEditorReady,
  options,
  onMount,
  ...rest
}: MonacoEditorLazyProps) {
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      onEditorReady?.(editor);
      onMount?.(editor, monaco);
    },
    [onEditorReady, onMount]
  );

  return (
    <Editor
      loading={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading editor...
        </div>
      }
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
        ...options,
      }}
      onMount={handleMount}
      {...rest}
    />
  );
}
