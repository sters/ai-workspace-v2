"use client";

import { useState, useCallback, useEffect } from "react";
import { MonacoEditorLazy } from "@/components/shared/content/monaco-editor-lazy";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { StatusBadge } from "@/components/shared/feedback/status-badge";
import { postJson } from "@/lib/api-client";

export function ConfigEditor({
  filePath,
  exists,
  content,
  language,
  saveEndpoint,
  saveBody,
  onSaved,
  notFoundLabel,
  editorOptions,
}: {
  filePath: string;
  exists: boolean;
  content: string | null;
  language: "json" | "yaml";
  saveEndpoint: string;
  /** Extra fields to include in the POST body (merged with { content }). */
  saveBody?: Record<string, string>;
  onSaved: () => void;
  notFoundLabel?: string;
  editorOptions?: Record<string, unknown>;
}) {
  const [value, setValue] = useState(content ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setValue(content ?? "");
  }, [content]);

  const isValidContent = useCallback(
    (text: string) => {
      if (!text.trim()) return false;
      if (language === "json") {
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      }
      // YAML: any non-empty string is considered valid (server validates)
      return true;
    },
    [language],
  );

  const valid = isValidContent(value);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      const result = await postJson(saveEndpoint, {
        ...saveBody,
        content: value,
      });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      onSaved();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }, [saveEndpoint, saveBody, value, onSaved]);

  const showInvalidWarning = language === "json" && value.trim() && !valid;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <code className="text-xs text-muted-foreground">{filePath}</code>
        {!exists && (
          <StatusBadge
            label={notFoundLabel ?? "not found"}
            variant="muted"
            shape="square"
          />
        )}
      </div>

      <div className={`h-[32rem] rounded-md border ${showInvalidWarning ? "border-red-500" : ""}`}>
        <MonacoEditorLazy
          language={language}
          value={value}
          onChange={(v) => setValue(v ?? "")}
          options={{
            renderLineHighlight: "none",
            folding: language === "yaml",
            ...(language === "yaml" ? { tabSize: 2 } : {}),
            ...editorOptions,
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
        {showInvalidWarning && (
          <span className="text-xs text-red-500">Invalid JSON</span>
        )}
        {saveSuccess && (
          <span className="text-xs text-green-500">Saved.</span>
        )}
      </div>
    </Card>
  );
}
