"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/shared/buttons";
import { Input, Textarea } from "@/components/shared/forms";
import { Spinner } from "@/components/shared/feedback";
import { useRepositories } from "@/hooks/use-repositories";
import { postJson } from "@/lib/api";
import {
  dateStamp,
  deriveBranchName,
  quickWorkspaceName,
  sanitizeSlug,
  workspaceDirName,
} from "@/lib/naming";
import type { SetupRepositoryResult } from "@/types/pipeline";

/** The default first, since it is also the dropdown's initial value. */
const TASK_TYPES = ["feature", "bugfix", "research", "review"] as const;

interface QuickCreateResponse {
  workspace: string;
  workspacePath: string;
  repositories: SetupRepositoryResult[];
  problems: { repository: string; error: string }[];
  log: string[];
}

/** Repository paths as typed: whitespace- or comma-separated. */
function parseExtraRepositories(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

/**
 * The chat the note can be handed to. The note travels in the URL as the
 * chat's task: the chat page applies it only to a session it starts, so a
 * reload resumes the running session rather than starting the work again.
 */
function chatHref(workspace: string, task: string): string {
  const query = task ? `?${new URLSearchParams({ task })}` : "";
  return `/workspace/${encodeURIComponent(workspace)}/chat/interactive${query}`;
}

export function QuickCreateForm() {
  const { repositories, isLoading, error: listError } = useRepositories();

  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]>("feature");
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  /**
   * The created workspace, with the note as it read when it was sent: the
   * textarea stays editable afterwards, and the chat link must carry the
   * request the README was written from.
   */
  const [created, setCreated] = useState<{ response: QuickCreateResponse; task: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * `sent` is terminal, and it is what stops a second workspace being created.
   * The in-flight click is already swallowed by `Button`, but nothing navigates
   * away on success, so the button stays in front of the user — and a second
   * POST creates a whole second workspace (`setupWorkspace` gives the collision
   * a `-2`), not a retry. Only a request the server *refused* returns to
   * `idle`, since that is the one answer that says nothing was created.
   */
  const [status, setStatus] = useState<"idle" | "creating" | "sent">("idle");

  const chosen = useMemo(
    () => [...new Set([...selected, ...parseExtraRepositories(extra)])],
    [selected, extra],
  );

  /** What the workspace ends up called: the typed name, or the note's first line. */
  const effectiveName = useMemo(() => quickWorkspaceName(name, note), [name, note]);

  /**
   * The names the server will produce, from the same functions it uses. It
   * renders only once there is a name to show, which also keeps it out of the
   * server render — `new Date()` on both sides would mismatch across midnight.
   */
  const preview = useMemo(() => {
    if (!effectiveName) return null;
    const stamp = dateStamp(new Date());
    const workspace = workspaceDirName({ taskType, name: effectiveName, dateStamp: stamp });
    return {
      workspace,
      branch: deriveBranchName(workspace, "", stamp),
      derived: !name.trim(),
      title: effectiveName,
      // Asking for `workspace` is not the fallback firing.
      collapsed:
        sanitizeSlug(effectiveName) === "workspace" && !/workspace/i.test(effectiveName),
    };
  }, [effectiveName, name, taskType]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle
      ? repositories.filter((repo) => repo.repoPath.toLowerCase().includes(needle))
      : repositories;
  }, [repositories, filter]);

  const toggle = (repoPath: string) => {
    setSelected((prev) =>
      prev.includes(repoPath) ? prev.filter((p) => p !== repoPath) : [...prev, repoPath],
    );
  };

  const create = async () => {
    setFailure(null);
    setCreated(null);
    setStatus("creating");

    let response;
    try {
      response = await postJson<QuickCreateResponse>("/api/workspaces", {
        // Sent as typed — the server derives from the note with the same rule,
        // so an empty name is not a second copy of the derivation.
        name: name.trim(),
        taskType,
        repositories: chosen,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch (err) {
      // The request never came back, so whether it created anything is unknown.
      // Staying disabled is the safe half of that: a blind retry is how the
      // duplicate gets made.
      setStatus("sent");
      setFailure(
        `${String(err)} — the workspace may still have been created. Check the dashboard before creating it again.`,
      );
      return;
    }

    if (!response.ok) {
      setStatus("idle");
      setFailure(response.error);
      return;
    }

    setStatus("sent");
    setCreated({ response: response.data, task: note.trim() });
  };

  return (
    <div className="w-full space-y-4">
      <div>
        <label htmlFor="quick-note" className="mb-1 block text-xs font-medium">
          What you want to do
        </label>
        <Textarea
          id="quick-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Fix the login crash on token expiry — the refresh path 500s instead of retrying."
          rows={4}
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Kept verbatim in the README&apos;s Initial Request. Open the chat from the link this
          leaves behind and it is handed to the session as its request, which starts on it
          straight away.
        </p>
      </div>

      <div>
        <label htmlFor="quick-name" className="mb-1 block text-xs font-medium">
          Name (optional)
        </label>
        <Input
          id="quick-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. login-crash — leave blank to use the note's first line"
          className="w-full"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Becomes the README title verbatim. Its ASCII slug names the workspace directory and
          every branch. Leave it blank and the first line of the note below is used.
        </p>
        {preview && (
          <div className="mt-1 space-y-0.5 text-xs">
            {preview.derived && (
              <p className="text-muted-foreground">
                Named from the note: <code className="font-mono">{preview.title}</code>
              </p>
            )}
            <p className="text-muted-foreground">
              Workspace <code className="font-mono">{preview.workspace}</code>
              {" · "}branch <code className="font-mono">{preview.branch}</code>
            </p>
            {preview.collapsed && (
              <p className="text-amber-700 dark:text-amber-400">
                The name has nothing that survives slugging, so the directory and branch fall
                back to <code className="font-mono">workspace</code>. Add an ASCII name to make
                the branch say what it is.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="quick-task-type" className="mb-1 block text-xs font-medium">
          Task type
        </label>
        <select
          id="quick-task-type"
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as (typeof TASK_TYPES)[number])}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Repositories</span>
          {repositories.length > 8 && (
            <Input
              aria-label="Filter repositories"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter"
              className="w-40 py-0.5 text-xs"
            />
          )}
        </div>

        {isLoading && <Spinner />}
        {listError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Failed to list repositories: {String(listError)}
          </p>
        )}
        {!isLoading && repositories.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No repository has been cloned yet. Type a path below and it will be cloned.
          </p>
        )}

        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border p-2">
          {visible.map((repo) => (
            <label
              key={repo.repoPath}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={selected.includes(repo.repoPath)}
                onChange={() => toggle(repo.repoPath)}
              />
              <span className="truncate">{repo.repoPath}</span>
              {repo.baseBranch && (
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {repo.baseBranch}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="mt-2">
          <label htmlFor="quick-extra" className="mb-1 block text-xs font-medium">
            Add repository
          </label>
          <Input
            id="quick-extra"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="github.com/org/repo — separate several with spaces"
            className="w-full"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Not cloned yet, or the same repository twice with a <code>:alias</code> suffix for a
            second worktree.
          </p>
        </div>
      </div>

      <Button
        onClick={create}
        disabled={!effectiveName || chosen.length === 0 || status !== "idle"}
      >
        {status === "creating" ? (
          <>
            <Spinner />
            Creating workspace…
          </>
        ) : (
          "Create workspace"
        )}
      </Button>

      {failure && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {failure}
        </div>
      )}

      {created && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p>
            Workspace <code className="font-mono">{created.response.workspace}</code> is ready,
            and is in the sidebar. Nothing is running in it yet.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={chatHref(created.response.workspace, created.task)}
              className="font-medium underline"
            >
              Start a chat on it
            </Link>
            <Link
              href={`/workspace/${encodeURIComponent(created.response.workspace)}`}
              className="underline"
            >
              Open the workspace
            </Link>
          </div>
          {created.response.problems.length > 0 && (
            <div
              role="alert"
              className="space-y-2 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              <p>
                {created.response.problems.length} repositor
                {created.response.problems.length === 1 ? "y" : "ies"} could not be set up. Only
                the worktrees that exist are declared in its README.
              </p>
              <ul className="space-y-1">
                {created.response.problems.map((problem) => (
                  <li key={problem.repository} className="font-mono text-xs">
                    {problem.repository}: {problem.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
