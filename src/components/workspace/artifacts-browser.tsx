"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useArtifacts, useArtifactFile } from "@/hooks/use-workspace";
import { Callout } from "../shared/containers/callout";
import { Card } from "../shared/containers/card";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusText } from "../shared/feedback/status-text";
import { ARTIFACT_MAX_BYTES } from "@/lib/constants";
import { cn, formatBytes } from "@/lib/utils";
import type { ArtifactEntry, ArtifactFileContent } from "@/types/artifact";

/**
 * The workspace's `artifacts/` directory as a file tree.
 *
 * Reviews, research and the memo have tabs that read the files they know the
 * shape of. This one reads the directory, so the files no tab was written for —
 * the known-findings ledger, the grounding and validation stores, whatever an
 * agent wrote next to them — are reachable too.
 *
 * The selected file lives in `?file=`, so a reload and a pasted link land on it.
 */
export function ArtifactsBrowser({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("file");

  const { entries, truncated, isLoading } = useArtifacts(workspaceName);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  /**
   * Top-level directories start open, and so does every ancestor of the selected
   * file — a linked file has to be visible in the tree without a click. Deeper
   * directories start closed: a workspace's `reviews/` holds one directory per
   * session, each with a dozen files.
   */
  const isExpanded = (dirEntry: ArtifactEntry): boolean => {
    const override = overrides[dirEntry.path];
    if (override !== undefined) return override;
    if (dirEntry.depth === 0) return true;
    return selected !== null && selected.startsWith(`${dirEntry.path}/`);
  };

  const visible = useMemo(() => {
    const rows: ArtifactEntry[] = [];
    let hiddenUnder: string | null = null;
    for (const item of entries) {
      if (hiddenUnder && item.path.startsWith(hiddenUnder)) continue;
      hiddenUnder = null;
      rows.push(item);
      if (item.isDir && !isExpanded(item)) hiddenUnder = `${item.path}/`;
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, overrides, selected]);

  const select = (filePath: string) => {
    router.replace(
      `/workspace/${encodeURIComponent(workspaceName)}/artifacts?file=${encodeURIComponent(filePath)}`,
      { scroll: false },
    );
  };

  if (isLoading && entries.length === 0) {
    return <StatusText>Loading...</StatusText>;
  }

  if (entries.length === 0) {
    return <StatusText>No artifacts in this workspace yet.</StatusText>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
      <Card variant="flush" className="h-fit overflow-hidden py-1">
        <ul className="text-sm">
          {visible.map((item) =>
            item.isDir ? (
              <DirectoryRow
                key={item.path}
                entry={item}
                expanded={isExpanded(item)}
                onToggle={() =>
                  setOverrides((prev) => ({ ...prev, [item.path]: !isExpanded(item) }))
                }
              />
            ) : (
              <FileRow
                key={item.path}
                entry={item}
                active={item.path === selected}
                onSelect={() => select(item.path)}
              />
            ),
          )}
        </ul>
        {truncated && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Too many files to list them all — some are not shown.
          </p>
        )}
      </Card>

      <div className="min-w-0">
        {selected ? (
          <ArtifactViewer workspaceName={workspaceName} filePath={selected} />
        ) : (
          <StatusText>Select a file.</StatusText>
        )}
      </div>
    </div>
  );
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 0.75 + 0.5}rem` };
}

const ROW_CLASS =
  "flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-accent";

function DirectoryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ArtifactEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const FolderGlyph = expanded ? FolderOpen : Folder;
  return (
    <li>
      <button type="button" onClick={onToggle} className={ROW_CLASS} style={indent(entry.depth)}>
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <FolderGlyph className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{entry.name}</span>
      </button>
    </li>
  );
}

/**
 * A review session's files are named `<KIND>-github.com_<org>_<repo>.md`, so
 * plain truncation renders two siblings identically and the only way to tell
 * them apart is to click one. Long names therefore truncate in the middle: the
 * head gives way and the tail, which is what differs, stays on screen.
 */
const NAME_TRUNCATE_FROM = 28;
const NAME_TAIL_CHARS = 14;

function FileName({ name }: { name: string }) {
  if (name.length <= NAME_TRUNCATE_FROM) return <span className="truncate">{name}</span>;
  return (
    <span className="flex min-w-0">
      <span className="truncate">{name.slice(0, -NAME_TAIL_CHARS)}</span>
      <span className="shrink-0">{name.slice(-NAME_TAIL_CHARS)}</span>
    </span>
  );
}

function FileGlyph({ name }: { name: string }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return <FileText className={className} />;
  }
  if (name.endsWith(".json")) return <FileCode className={className} />;
  return <FileIcon className={className} />;
}

function FileRow({
  entry,
  active,
  onSelect,
}: {
  entry: ArtifactEntry;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(ROW_CLASS, active && "bg-accent font-medium")}
        style={indent(entry.depth)}
        title={entry.path}
      >
        <span className="w-3.5 shrink-0" />
        <FileGlyph name={entry.name} />
        <FileName name={entry.name} />
        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
          {formatBytes(entry.size)}
        </span>
      </button>
    </li>
  );
}

function ArtifactViewer({
  workspaceName,
  filePath,
}: {
  workspaceName: string;
  filePath: string;
}) {
  const { file, isLoading, error } = useArtifactFile(workspaceName, filePath);
  const [showSource, setShowSource] = useState(false);

  if (error) {
    return (
      <Callout variant="error">
        <p className="font-medium">{filePath}</p>
        <p className="text-sm">
          This artifact could not be read. It may have been removed or rewritten by a
          running operation.
        </p>
      </Callout>
    );
  }

  if (!file) {
    return <StatusText>{isLoading ? "Loading..." : "Select a file."}</StatusText>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{file.path}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}
          </p>
        </div>
        {file.kind === "markdown" && (
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            {showSource ? "Rendered" : "Source"}
          </button>
        )}
      </div>

      {file.truncated && (
        <Callout variant="warning" className="text-sm">
          Showing the first {formatBytes(ARTIFACT_MAX_BYTES)} of {formatBytes(file.size)}.
        </Callout>
      )}

      <ArtifactBody file={file} showSource={showSource} />
    </div>
  );
}

function ArtifactBody({
  file,
  showSource,
}: {
  file: ArtifactFileContent;
  showSource: boolean;
}) {
  if (file.kind === "binary") {
    return (
      <Callout variant="info" className="text-sm">
        {formatBytes(file.size)} — this is not a text file, so it is not shown here.
      </Callout>
    );
  }

  if (file.kind === "markdown" && !showSource) {
    return (
      <Card>
        <MarkdownRenderer content={file.content} />
      </Card>
    );
  }

  return <Pre>{file.kind === "json" ? prettyJson(file.content) : file.content}</Pre>;
}

/** Pretty-print when it parses; a mangled or truncated store is still worth reading as it stands. */
function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function Pre({ children }: { children: string }) {
  return (
    <Card variant="flush" className="overflow-x-auto p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {children}
      </pre>
    </Card>
  );
}
