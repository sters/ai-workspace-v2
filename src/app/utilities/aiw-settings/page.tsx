"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { MonacoEditorLazy } from "@/components/shared/content/monaco-editor-lazy";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { StatusText } from "@/components/shared/feedback/status-text";
import { PageHeader } from "@/components/shared/feedback/page-header";

type ConfigData = {
  filePath: string;
  exists: boolean;
  content: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AiwSettingsPage() {
  const { data, error, isLoading, mutate } = useSWR<ConfigData>(
    "/api/aiw-settings",
    fetcher,
  );

  return (
    <div>
      <PageHeader
        title="AI Workspace Settings"
        description={
          <>
            Edit{" "}
            <code className="text-xs">~/.config/ai-workspace/config.yml</code>.
            Changes take effect immediately (cached config is invalidated on
            save).
          </>
        }
      />
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">Failed to load settings.</StatusText>
      )}
      {data && <ConfigEditor data={data} onSaved={() => mutate()} />}
    </div>
  );
}

function ConfigEditor({
  data,
  onSaved,
}: {
  data: ConfigData;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(data.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setValue(data.content ?? "");
  }, [data.content]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      const res = await fetch("/api/aiw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSaveError(result.error ?? "Failed to save");
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
  }, [value, onSaved]);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <code className="text-xs text-muted-foreground">{data.filePath}</code>
        {!data.exists && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            not found (will be created on save)
          </span>
        )}
      </div>

      <div className="h-[32rem] rounded-md border">
        <MonacoEditorLazy
          language="yaml"
          value={value}
          onChange={(v) => setValue(v ?? "")}
          options={{
            renderLineHighlight: "none",
            folding: true,
            tabSize: 2,
          }}
        />
      </div>

      {saveError && (
        <p className="mt-1 text-xs text-destructive">{saveError}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {saveSuccess && (
          <span className="text-xs text-green-500">
            Saved. Config reloaded.
          </span>
        )}
      </div>
    </Card>
  );
}
