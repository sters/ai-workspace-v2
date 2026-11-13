"use client";

import Link from "next/link";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { RepositoryActionButton } from "./repository-action-button";
import { DropdownMenu, type DropdownItem } from "../shared/menus/dropdown-menu";
import { showToast } from "../shared/feedback/toast";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useOpeners } from "@/hooks/use-openers";
import { useArchiveToggle } from "@/hooks/use-archive-toggle";
import { ArchiveOpenPrsConfirm } from "./archive-open-prs-confirm";
import { openWith } from "@/lib/api";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  FolderOpen,
  Trash2,
  Archive,
  ArchiveRestore,
} from "lucide-react";

export function OperationActions({
  workspaceName,
  workspacePath,
  repositories,
}: {
  workspaceName: string;
  workspacePath: string;
  /** Repository metadata from workspace README for "Open in editor" dropdown. */
  repositories?: { alias: string; path: string }[];
}) {
  const { isWorkspaceRunning, isRepoBusy } = useRunningOperations();
  const isRunning = isWorkspaceRunning(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const { openers } = useOpeners();

  // Build "Open in..." menu structure: opener × (Root + each repository).
  const pathTargets = [
    { label: "Root", subPath: undefined as string | undefined },
    ...(repositories ?? []).map((r) => ({ label: r.alias, subPath: r.path })),
  ];
  const openerMenuItems: DropdownItem[] = openers.map((opener) => ({
    kind: "group" as const,
    label: opener.name,
    items: pathTargets.map((target) => ({
      label: target.label,
      onSelect: async () => {
        try {
          await openWith(workspacePath, opener.name, target.subPath);
        } catch (err) {
          showToast(
            err instanceof Error
              ? err.message
              : `Failed to launch ${opener.name}`,
            "error",
          );
        }
      },
    })),
  }));

  const body = (extra?: Record<string, string>) => ({
    workspace: workspacePath,
    ...extra,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SplitButton
        label={<><Play className="h-3.5 w-3.5" /> Start autonomous</>}
        onClick={() =>
          startAndNavigate("autonomous", body({ startWith: "execute" }))
        }
        disabled={isRunning}
        items={[
          {
            label: "Execute only",
            onClick: () => startAndNavigate("execute", body()),
          },
        ]}
      />
      <SplitButton
        variant="secondary"
        label={<><ClipboardCheck className="h-3.5 w-3.5" /> Review</>}
        onClick={() => startAndNavigate("review", body())}
        disabled={isRunning}
        items={[
          {
            // Fetches and fast-forwards each worktree first, so a PR that
            // moved since checkout is reviewed as it now stands. Not the
            // default: on a workspace the pipeline is writing to, moving HEAD
            // is the wrong thing to do.
            label: "Re-review (fetch PR updates first)",
            onClick: () =>
              startAndNavigate("review", body({ refreshFromRemote: "true" })),
          },
        ]}
      />
      <RepositoryActionButton
        label={<><GitPullRequest className="h-3.5 w-3.5" /> Create PR</>}
        onClick={() => startAndNavigate("create-pr", body())}
        disabled={isRunning}
        repositories={repositories}
        onRepoClick={(repo) =>
          startAndNavigate("create-pr", body({ repository: repo.path }))
        }
        isRepoDisabled={(repo) => isRepoBusy(workspaceName, repo.path)}
      />
      {openerMenuItems.length > 0 && (
        <DropdownMenu
          ariaLabel="Open in..."
          trigger={
            <>
              <FolderOpen className="h-3.5 w-3.5" /> Open in...
            </>
          }
          items={openerMenuItems}
        />
      )}
    </div>
  );
}

/** Archive / unarchive and delete, with the open-PR confirmation archiving may need. */
export function WorkspaceManageButtons({
  workspaceName,
  workspacePath,
  archived,
  archive,
  onArchiveError,
}: {
  workspaceName: string;
  workspacePath: string;
  archived?: boolean;
  /**
   * The archive toggle, owned by the caller so a suggestion can start the same
   * confirmation. The button is omitted without it — a toggle nothing re-reads
   * leaves the label stating the opposite of the truth.
   */
  archive?: ReturnType<typeof useArchiveToggle>;
  onArchiveError?: (err: unknown) => void;
}) {
  const { isWorkspaceRunning } = useRunningOperations();
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const report = onArchiveError ?? (() => {});

  return (
    <>
      {archive && (
        <Button variant="secondary" onClick={() => archive.toggle(workspaceName).catch(report)}>
          {archived ? (
            <>
              <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" /> Archive
            </>
          )}
        </Button>
      )}
      <Button
        variant="destructive"
        onClick={() =>
          startAndNavigate("delete", { workspace: workspacePath })
        }
        disabled={isWorkspaceRunning(workspaceName)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete workspace
      </Button>
    </>
  );
}

export function useWorkspaceArchive(archived: boolean | undefined, onArchived: () => void) {
  const archive = useArchiveToggle(onArchived);
  const reportError = (err: unknown) =>
    showToast(
      err instanceof Error
        ? err.message
        : `Failed to ${archived ? "unarchive" : "archive"} workspace`,
      "error",
    );
  return { archive, reportError };
}

export function ArchiveConfirm({
  archive,
  onError,
}: {
  archive: ReturnType<typeof useArchiveToggle>;
  onError: (err: unknown) => void;
}) {
  if (!archive.openPrs) return null;
  return (
    <ArchiveOpenPrsConfirm
      prs={archive.openPrs}
      onConfirm={() => archive.confirmClose().catch(onError)}
      onCancel={archive.cancel}
    />
  );
}

/** What the running operation on this workspace is doing, linked to it. */
export function RunningOperationNotice({ workspaceName }: { workspaceName: string }) {
  const { operations } = useRunningOperations();
  const runningOp = operations.find(
    (op) => op.status === "running" && op.workspace === workspaceName,
  );
  if (!runningOp) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <span className={`inline-block h-2 w-2 animate-pulse rounded-full mr-1.5 ${runningOp.hasPendingAsk ? "bg-orange-500" : runningOp.usageLimitWaitUntil ? "bg-amber-500" : "bg-blue-500"}`} />
      {runningOp.hasPendingAsk
        ? "Waiting for input"
        : runningOp.usageLimitWaitUntil
          ? `Waiting for the usage limit to reset (${new Date(runningOp.usageLimitWaitUntil).toLocaleTimeString()})`
          : "Operation running"} &mdash;{" "}
      <Link
        href={`/workspace/${encodeURIComponent(workspaceName)}/operations?operationId=${encodeURIComponent(runningOp.id)}`}
        className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {runningOp.hasPendingAsk ? "Answer now" : "View running operation"}
      </Link>
    </p>
  );
}
