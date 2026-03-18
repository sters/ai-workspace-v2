"use client";

import useSWR from "swr";
import { ConfigEditor } from "@/components/utilities/config-editor";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher } from "@/lib/api-client";

type SettingsEntry = {
  scope: string;
  filePath: string;
  exists: boolean;
  content: string | null;
  error: string | null;
};

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
      {entry && (
        <>
          {entry.error && (
            <p className="mb-2 text-xs text-destructive">{entry.error}</p>
          )}
          <ConfigEditor
            filePath={entry.filePath}
            exists={entry.exists}
            content={entry.content}
            language="json"
            saveEndpoint="/api/claude-settings"
            saveBody={{ scope: entry.scope }}
            onSaved={() => mutate()}
            editorOptions={{ folding: false }}
          />
        </>
      )}
    </div>
  );
}
