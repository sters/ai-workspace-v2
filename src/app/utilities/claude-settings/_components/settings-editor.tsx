"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { MonacoEditorLazy } from "@/components/shared/content/monaco-editor-lazy";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { StatusText } from "@/components/shared/feedback/status-text";
import type { editor } from "monaco-editor";

type SettingsEntry = {
  scope: string;
  filePath: string;
  exists: boolean;
  content: string | null;
  error: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function SettingsEditor({ scope }: { scope: "project" | "local" | "user" }) {
  const { data, error, isLoading, mutate } = useSWR<{
    settings: SettingsEntry[];
  }>("/api/claude-settings", fetcher);

  const entry = data?.settings.find((s) => s.scope === scope);

  return (
    <div>
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">Failed to load settings.</StatusText>
      )}
      {entry && <EditorCard entry={entry} onSaved={() => mutate()} />}
    </div>
  );
}

function EditorCard({
  entry,
  onSaved,
}: {
  entry: SettingsEntry;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(entry.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    setValue(entry.content ?? "");
  }, [entry.content]);

  const isValidJson = useCallback((text: string) => {
    if (!text.trim()) return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  const valid = isValidJson(value);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: entry.scope, content: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save");
        return;
      }
      onSaved();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [entry.scope, value, onSaved]);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <code className="text-xs text-muted-foreground">{entry.filePath}</code>
        {!entry.exists && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            not found
          </span>
        )}
      </div>

      {entry.error && (
        <p className="mb-2 text-xs text-destructive">{entry.error}</p>
      )}

      <div className={`h-80 rounded-md border ${value.trim() && !valid ? "border-red-500" : ""}`}>
        <MonacoEditorLazy
          language="json"
          value={value}
          onChange={(v) => setValue(v ?? "")}
          onEditorReady={(ed) => { editorRef.current = ed; }}
          options={{
            renderLineHighlight: "none",
            folding: false,
          }}
        />
      </div>

      {saveError && (
        <p className="mt-1 text-xs text-destructive">{saveError}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !valid}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {value.trim() && !valid && (
          <span className="text-xs text-red-500">Invalid JSON</span>
        )}
      </div>
    </Card>
  );
}
