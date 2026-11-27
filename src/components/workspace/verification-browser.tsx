import { useState } from "react";
import { useRouter, useSearchParams } from "@/lib/router/navigation";
import { Play } from "lucide-react";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useArtifactFile, useArtifacts } from "@/hooks/use-workspace";
import { Button } from "../shared/buttons/button";
import { Card } from "../shared/containers/card";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusText } from "../shared/feedback/status-text";
import { SnippetPicker } from "../shared/forms/snippet-picker";
import { Textarea } from "../shared/forms/textarea";
import { cn, formatReviewTimestamp } from "@/lib/utils";

const REPORT_PATH = /^verification\/(\d{8}-\d{6})\/report\.md$/;

/**
 * The workspace's verification reports, newest first, each written by a
 * `verify` operation into `artifacts/verification/<timestamp>/`. Laid out like
 * Artifacts — the reports on the left, the selected one on the right — with
 * the selection in `?report=`.
 */
export function VerificationBrowser({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { entries, isLoading } = useArtifacts(workspaceName);
  const reports = entries
    .flatMap((e) => (e.isDir ? [] : (REPORT_PATH.exec(e.path)?.slice(1, 2) ?? [])))
    .sort()
    .reverse();
  const selected = searchParams.get("report") ?? reports[0] ?? null;
  const { file } = useArtifactFile(workspaceName, selected ? `verification/${selected}/report.md` : null);

  const select = (ts: string) => {
    router.replace(
      `/workspace/${encodeURIComponent(workspaceName)}/verify?report=${encodeURIComponent(ts)}`,
      { scroll: false },
    );
  };

  if (isLoading && entries.length === 0) return <StatusText>Loading...</StatusText>;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
      <div className="space-y-4">
        <VerifyForm workspaceName={workspaceName} />
        {reports.length > 0 && (
          <Card variant="flush" className="h-fit overflow-hidden py-1">
            <ul className="text-sm">
              {reports.map((ts) => (
                <li key={ts}>
                  <button
                    type="button"
                    onClick={() => select(ts)}
                    className={cn(
                      "flex w-full items-center px-3 py-1.5 text-left hover:bg-accent",
                      ts === selected && "bg-accent font-medium",
                    )}
                  >
                    {formatReviewTimestamp(ts)}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="min-w-0">
        {selected && file ? (
          <Card>
            <MarkdownRenderer
              content={file.content}
              resolveImageSrc={(src) =>
                `/api/workspaces/${encodeURIComponent(workspaceName)}/artifacts/file?raw=1&path=${encodeURIComponent(`verification/${selected}/${src}`)}`
              }
            />
          </Card>
        ) : (
          <StatusText>
            No verification reports yet. Verify runs the change and reports what it did and saw, asking you only for what it cannot do itself.
          </StatusText>
        )}
      </div>
    </div>
  );
}

function appendSnippet(text: string, snippet: string): string {
  return text.trim() ? `${text}\n\n${snippet}` : snippet;
}

function VerifyForm({ workspaceName }: { workspaceName: string }) {
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const [instruction, setInstruction] = useState("");
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Verify</p>
        <SnippetPicker kind="verify" onInsert={(content) => setInstruction((v) => appendSnippet(v, content))} />
      </div>
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Optional: what to check, or how (e.g. which environment). Without it, the README's acceptance criteria."
        rows={3}
      />
      <Button
        onClick={async () => {
          if (await startAndNavigate("verify", { workspace: workspaceName, instruction })) setInstruction("");
        }}
      >
        <Play className="h-3.5 w-3.5" />
        Verify with Claude
      </Button>
    </Card>
  );
}
