import useSWR from "swr";
import { ConfigEditor } from "@/components/utilities/config-editor";
import { StatusText } from "@/components/shared/feedback/status-text";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { fetcher } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";

type ConfigData = {
  filePath: string;
  exists: boolean;
  content: string | null;
};

export default function AiwSettingsPage() {
  useDocumentTitle("AIW Settings");
  const { data, error, isLoading, mutate } = useSWR<ConfigData>(
    "/api/aiw-settings",
    fetcher,
  );

  return (
    <div>
      <PageHeader
        title="AIW Settings"
        description={
          <>
            Edit{" "}
            <code className="text-xs">.ai-workspace/config.yml</code>.
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
