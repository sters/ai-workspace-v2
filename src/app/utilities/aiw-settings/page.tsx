"use client";

import useSWR from "swr";
import { ConfigEditor } from "@/components/utilities/config-editor";
import { StatusText } from "@/components/shared/feedback/status-text";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { fetcher } from "@/lib/api";

type ConfigData = {
  filePath: string;
  exists: boolean;
  content: string | null;
};

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
      {data && (
        <ConfigEditor
          filePath={data.filePath}
          exists={data.exists}
          content={data.content}
          language="yaml"
          saveEndpoint="/api/aiw-settings"
          onSaved={() => mutate()}
          notFoundLabel="not found (will be created on save)"
        />
      )}
    </div>
  );
}
