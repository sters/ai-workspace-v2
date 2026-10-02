"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  ListTodo,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { useChangeComments } from "@/hooks/use-change-comments";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useViewportFillHeight } from "@/hooks/use-viewport-fill-height";
import { useWorkspaceChangeDiff, useWorkspaceChanges } from "@/hooks/use-workspace";
import { Button } from "../shared/buttons/button";
import { Callout } from "../shared/containers/callout";
import { Card } from "../shared/containers/card";
import { UnifiedDiffViewer, type DiffZone } from "../shared/content/unified-diff-viewer";
import { StatusText } from "../shared/feedback/status-text";
import { Textarea } from "../shared/forms/textarea";
import { chatPagePath, stashChatHandoff } from "@/lib/chat-handoff";
import {
  anchorComment,
  buildCommentsTopic,
  describeRange,
  locateComment,
  type ChangeComment,
} from "@/lib/change-comments";
import { CHANGES_DIFF_MAX_BYTES } from "@/lib/constants";
import { buildFileTree, type FileTreeRow } from "@/lib/file-tree";
import { buildChangeCommentsTodoInstruction } from "@/lib/templates/prompts/change-comments-todo";
import { hunkBody, mapHunkLines, type LineRangeDescription } from "@/lib/unified-diff";
import { cn, formatBytes } from "@/lib/utils";
import type { ChangedFile, ChangedFileStatus, RepoChangeSet } from "@/types/changes";

/**
 * Every worktree's change against its base branch: one collapsible group per
 * repository, each a file tree, with the selected file's diff beside them.
 *
 * Lines selected in a diff can be commented on, the comment shown under them the
 * way a pull request review shows it. The comments are collected across files
 * and handed over together: as the opening message of a new chat session, or as
 * an `autonomous` run that plans what they ask for and carries it out.
 *
 * The selected file lives in `?repo=&file=`, so a reload and a pasted link land
 * on it.
 */
export function ChangesBrowser({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRepo = searchParams.get("repo");
  const selectedFile = searchParams.get("file");

  const { repos, isLoading, refresh } = useWorkspaceChanges(workspaceName);
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set());
  const comments = useChangeComments(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const { isWorkspaceRunning } = useRunningOperations();

  const select = (repoPath: string, filePath: string) => {
    const query = new URLSearchParams({ repo: repoPath, file: filePath });
    router.replace(`/workspace/${encodeURIComponent(workspaceName)}/changes?${query}`, {
      scroll: false,
    });
  };

  const talkInChat = () => {
    stashChatHandoff(workspaceName, { discussion: buildCommentsTopic(comments.items) });
    comments.clear();
    router.push(chatPagePath(workspaceName));
  };

  const makeTodos = async () => {
    // `repo` is a single value, so comments spanning worktrees run workspace-wide.
    const repoPaths = new Set(comments.items.map((c) => c.repoPath));
    const started = await startAndNavigate("autonomous", {
      workspace: workspaceName,
      startWith: "update-todo",
      instruction: buildChangeCommentsTodoInstruction(comments.items),
      ...(repoPaths.size === 1 && { repo: [...repoPaths][0] }),
    });
    if (started) comments.clear();
  };

  if (isLoading && repos.length === 0) {
    return <StatusText>Loading...</StatusText>;
  }

  if (repos.length === 0) {
    return <StatusText>This workspace has no repositories.</StatusText>;
  }

  const selectedRepoSet = repos.find((r) => r.repoPath === selectedRepo);
  const selectedEntry = selectedRepoSet?.files.find((f) => f.path === selectedFile);

  return (
    <div className="space-y-4">
      {comments.items.length > 0 && (
        <CommentsTray
          items={comments.items}
          onOpen={(c) => select(c.repoPath, c.filePath)}
          onRemove={comments.remove}
          onClear={comments.clear}
          onTalk={talkInChat}
          onMakeTodos={makeTodos}
          workspaceBusy={isWorkspaceRunning(workspaceName)}
        />
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(14rem,22rem)_1fr]">
        <div className="space-y-3">
          {repos.map((repo) => (
            <RepoGroup
              key={repo.repoPath}
              repo={repo}
              collapsed={collapsedRepos.has(repo.repoPath)}
              onToggle={() =>
                setCollapsedRepos((prev) => {
                  const next = new Set(prev);
                  if (next.has(repo.repoPath)) next.delete(repo.repoPath);
                  else next.add(repo.repoPath);
                  return next;
                })
              }
              selectedFile={repo.repoPath === selectedRepo ? selectedFile : null}
              onSelect={(filePath) => select(repo.repoPath, filePath)}
            />
          ))}
        </div>

        {/* Sticky, because a repository's tree runs far past one screen and
            the diff has to stay beside whichever file was clicked. */}
        <div className="min-w-0 self-start md:sticky md:top-4">
          {selectedRepoSet && selectedEntry ? (
            <ChangeViewer
              // Keyed so a comment being written does not follow the reader to another file.
              key={`${selectedRepoSet.repoPath}\0${selectedEntry.path}`}
              workspaceName={workspaceName}
              repoPath={selectedRepoSet.repoPath}
              file={selectedEntry}
              comments={comments.items.filter(
                (c) => c.repoPath === selectedRepoSet.repoPath && c.filePath === selectedEntry.path,
              )}
              onRefresh={() => refresh()}
              onAddComment={(range, comment) =>
                comments.add({
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  repoPath: selectedRepoSet.repoPath,
                  repoName: selectedRepoSet.repoName,
                  filePath: selectedEntry.path,
                  ...range,
                  comment,
                })
              }
              onSetComment={comments.setComment}
              onRemoveComment={comments.remove}
            />
          ) : (
            <StatusText>
              {selectedFile ? "This file is no longer changed." : "Select a file."}
            </StatusText>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentsTray({
  items,
  onOpen,
  onRemove,
  onClear,
  onTalk,
  onMakeTodos,
  workspaceBusy,
}: {
  items: ChangeComment[];
  onOpen: (comment: ChangeComment) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onTalk: () => void;
  onMakeTodos: () => Promise<void>;
  workspaceBusy: boolean;
}) {
  const uncommented = items.filter((c) => !c.comment.trim()).length;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {items.length} comment{items.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClear}>
            Clear
          </Button>
          <Button
            variant="secondary"
            onClick={onMakeTodos}
            disabled={uncommented > 0 || workspaceBusy}
            title={workspaceBusy ? "An operation is already running for this workspace." : undefined}
          >
            <ListTodo className="h-4 w-4" />
            Make TODOs
          </Button>
          <Button onClick={onTalk}>
            <MessageSquare className="h-4 w-4" />
            Talk in chat
          </Button>
        </div>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex min-w-0 flex-1 items-baseline gap-2 rounded px-1 text-left hover:bg-accent"
            >
              <span className="shrink-0 font-mono">{locateComment(item)}</span>
              <span
                className={cn(
                  "min-w-0 truncate",
                  item.comment.trim() ? "text-foreground" : "italic text-muted-foreground",
                )}
              >
                {item.comment.trim() || "no comment"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${locateComment(item)}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Talk in chat opens a new session with these as its first message. Make TODOs plans what
        they ask for into the TODO files and runs autonomous on them.
        {uncommented > 0 &&
          ` ${uncommented} ${uncommented === 1 ? "has" : "have"} no comment, which gives a TODO nothing to plan — add one or remove ${uncommented === 1 ? "it" : "them"} first.`}
      </p>
    </Card>
  );
}

function sumOf(files: ChangedFile[], key: "additions" | "deletions"): number {
  return files.reduce((sum, f) => sum + (f[key] ?? 0), 0);
}

function RepoGroup({
  repo,
  collapsed,
  onToggle,
  selectedFile,
  onSelect,
}: {
  repo: RepoChangeSet;
  collapsed: boolean;
  onToggle: () => void;
  selectedFile: string | null;
  onSelect: (filePath: string) => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <Card variant="flush" className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-2 py-2 text-left hover:bg-accent"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={repo.repoPath}>
          {repo.repoName}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{repo.files.length}</span>
        <span className="shrink-0 text-xs text-green-500">+{sumOf(repo.files, "additions")}</span>
        <span className="shrink-0 text-xs text-red-500">-{sumOf(repo.files, "deletions")}</span>
      </button>
      {!collapsed && (
        <div className="border-t py-1">
          <p className="flex items-center gap-1 px-3 pb-1 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            against origin/{repo.baseBranch || "?"}
          </p>
          {repo.error ? (
            <p className="px-3 py-1 text-xs text-red-500">{repo.error}</p>
          ) : repo.files.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">No changes.</p>
          ) : (
            <FileTree files={repo.files} selectedFile={selectedFile} onSelect={onSelect} />
          )}
        </div>
      )}
    </Card>
  );
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 0.75 + 0.5}rem` };
}

const ROW_CLASS = "flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-accent";

/** A changed file set is small, so every directory starts open. */
function FileTree({
  files,
  selectedFile,
  onSelect,
}: {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelect: (filePath: string) => void;
}) {
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const rows = useMemo(() => buildFileTree(files.map((f) => f.path)), [files]);

  const visible: FileTreeRow[] = [];
  let hiddenUnder: string | null = null;
  for (const row of rows) {
    if (hiddenUnder && row.path.startsWith(hiddenUnder)) continue;
    hiddenUnder = null;
    visible.push(row);
    if (row.isDir && collapsedDirs.has(row.path)) hiddenUnder = `${row.path}/`;
  }

  return (
    <ul className="text-sm">
      {visible.map((row) => {
        if (row.isDir) {
          const expanded = !collapsedDirs.has(row.path);
          const Chevron = expanded ? ChevronDown : ChevronRight;
          const FolderGlyph = expanded ? FolderOpen : Folder;
          return (
            <li key={row.path}>
              <button
                type="button"
                className={ROW_CLASS}
                style={indent(row.depth)}
                onClick={() =>
                  setCollapsedDirs((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.path)) next.delete(row.path);
                    else next.add(row.path);
                    return next;
                  })
                }
              >
                <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <FolderGlyph className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{row.name}</span>
              </button>
            </li>
          );
        }
        const file = byPath.get(row.path)!;
        return (
          <li key={row.path}>
            <button
              type="button"
              onClick={() => onSelect(row.path)}
              className={cn(ROW_CLASS, row.path === selectedFile && "bg-accent font-medium")}
              style={indent(row.depth)}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <span className="w-3.5 shrink-0" />
              <StatusMark status={file.status} />
              <span className={cn("truncate", file.status === "deleted" && "line-through")}>
                {row.name}
              </span>
              <LineCounts file={file} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_MARKS: Record<ChangedFileStatus, { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-green-500", label: "Added" },
  untracked: { letter: "U", className: "text-green-500", label: "Untracked" },
  modified: { letter: "M", className: "text-yellow-500", label: "Modified" },
  renamed: { letter: "R", className: "text-blue-500", label: "Renamed" },
  deleted: { letter: "D", className: "text-red-500", label: "Deleted" },
};

function StatusMark({ status }: { status: ChangedFileStatus }) {
  const mark = STATUS_MARKS[status];
  return (
    <span
      className={cn("w-3 shrink-0 text-center font-mono text-xs font-bold", mark.className)}
      title={mark.label}
    >
      {mark.letter}
    </span>
  );
}

function LineCounts({ file }: { file: ChangedFile }) {
  if (file.additions === null) {
    return <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">bin</span>;
  }
  return (
    <span className="ml-auto flex shrink-0 gap-1 pl-2 text-xs">
      <span className="text-green-500">+{file.additions}</span>
      <span className="text-red-500">-{file.deletions ?? 0}</span>
    </span>
  );
}

function ChangeViewer({
  workspaceName,
  repoPath,
  file,
  comments,
  onRefresh,
  onAddComment,
  onSetComment,
  onRemoveComment,
}: {
  workspaceName: string;
  repoPath: string;
  file: ChangedFile;
  comments: ChangeComment[];
  onRefresh: () => void;
  onAddComment: (range: LineRangeDescription, comment: string) => void;
  onSetComment: (id: string, comment: string) => void;
  onRemoveComment: (id: string) => void;
}) {
  const { diff, isLoading, error, refresh } = useWorkspaceChangeDiff(
    workspaceName,
    repoPath,
    file.path,
    `${file.status}:${file.additions}:${file.deletions}`,
  );
  // The page's bottom padding (`p-6` on <main>) plus the card's two borders.
  const { attach: attachFill, height: fillHeight } = useViewportFillHeight({
    bottomGap: 26,
    minHeight: 320,
  });
  const [draft, setDraft] = useState<LineRangeDescription | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const diffLines = useMemo(() => (diff ? mapHunkLines(hunkBody(diff.diff)) : []), [diff]);

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </p>
        <p className="text-xs text-muted-foreground">
          {STATUS_MARKS[file.status].label} · {repoPath}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          onRefresh();
          refresh();
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </Button>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <Callout variant="error" className="text-sm">
          This diff could not be read. The file may have changed back, or been committed away,
          since the list was loaded.
        </Callout>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="space-y-3">
        {header}
        <StatusText>{isLoading ? "Loading diff..." : "Select a file."}</StatusText>
      </div>
    );
  }

  const hasHunks = /^@@ /m.test(diff.diff);

  const zones: DiffZone[] = [];
  let unplaced = 0;
  for (const c of comments) {
    const at = anchorComment(diffLines, c);
    if (!at) {
      unplaced++;
      continue;
    }
    zones.push({
      key: c.id,
      ...at,
      content:
        editingId === c.id ? (
          <CommentEditor
            initial={c.comment}
            submitLabel="Save"
            onSubmit={(text) => {
              onSetComment(c.id, text);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <InlineComment
            comment={c}
            onEdit={() => setEditingId(c.id)}
            onDelete={() => onRemoveComment(c.id)}
          />
        ),
    });
  }
  const draftAt = draft && anchorComment(diffLines, draft);
  if (draft && draftAt) {
    zones.push({
      key: "draft",
      ...draftAt,
      content: (
        <CommentEditor
          initial=""
          submitLabel="Add"
          onSubmit={(text) => {
            onAddComment(draft, text);
            setDraft(null);
          }}
          onCancel={() => setDraft(null)}
        />
      ),
    });
  }

  return (
    <div className="space-y-3">
      {header}
      {diff.truncated && (
        <Callout variant="warning" className="text-sm">
          Showing the first {formatBytes(CHANGES_DIFF_MAX_BYTES)} of this diff.
        </Callout>
      )}
      {hasHunks && (
        <p className="text-xs text-muted-foreground">
          Select lines in the diff to comment on them.
          {unplaced > 0 &&
            ` ${unplaced} comment${unplaced === 1 ? "" : "s"} on this file no longer match${unplaced === 1 ? "es" : ""} the diff, so ${unplaced === 1 ? "it is" : "they are"} only in the list above.`}
        </p>
      )}
      {hasHunks ? (
        <Card variant="flush" className="overflow-hidden" ref={attachFill}>
          <UnifiedDiffViewer
            content={diff.diff}
            height={fillHeight ?? "calc(100vh - 10rem)"}
            onSelectLines={setDraft}
            zones={zones}
          />
        </Card>
      ) : (
        <StatusText>
          {file.additions === null
            ? "This is a binary file, so there is no line diff to show."
            : "No line changes — only the file's mode or name changed."}
        </StatusText>
      )}
    </div>
  );
}

function InlineComment({
  comment,
  onEdit,
  onDelete,
}: {
  comment: ChangeComment;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const said = comment.comment.trim();
  return (
    <div className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1">
        <span className="text-xs text-muted-foreground">{describeRange(comment)}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap break-words px-3 py-2 text-sm",
          !said && "italic text-muted-foreground",
        )}
      >
        {said || "No comment — the lines are handed over as they are."}
      </p>
    </div>
  );
}

function CommentEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="space-y-2 rounded-md border bg-card p-2 text-card-foreground shadow-sm">
      <Textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder="Leave a comment (optional)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit(text);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">⌘/Ctrl+Enter to {submitLabel.toLowerCase()}</span>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(text)}>{submitLabel}</Button>
      </div>
    </div>
  );
}
