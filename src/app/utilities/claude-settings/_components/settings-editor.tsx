"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";

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
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="text-sm text-destructive">Failed to load settings.</p>
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
    <div className="rounded-lg border p-4">
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

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`w-full rounded-md border bg-background p-3 font-mono text-sm ${
          value.trim() && !valid ? "border-red-500" : ""
        }`}
        rows={16}
        placeholder="{}"
      />

      {saveError && (
        <p className="mt-1 text-xs text-destructive">{saveError}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !valid}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {value.trim() && !valid && (
          <span className="text-xs text-red-500">Invalid JSON</span>
        )}
      </div>
    </div>
  );
}
