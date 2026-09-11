"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/shared/buttons";
import { Input, Textarea } from "@/components/shared/forms";
import { Spinner } from "@/components/shared/feedback";
import { useRepositories } from "@/hooks/use-repositories";
import { postJson } from "@/lib/api";
import { dateStamp, deriveBranchName, sanitizeSlug, workspaceDirName } from "@/lib/naming";
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

export function QuickCreateForm() {
  const router = useRouter();
  const { repositories, isLoading, error: listError } = useRepositories();

  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]>("feature");
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<QuickCreateResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const chosen = useMemo(
    () => [...new Set([...selected, ...parseExtraRepositories(extra)])],
    [selected, extra],
  );

  /**
   * The names the server will produce, from the same functions it uses. It
   * renders only once a name is typed, which also keeps it out of the server
   * render — `new Date()` on both sides would mismatch across midnight.
   */
  const preview = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const stamp = dateStamp(new Date());
    const workspace = workspaceDirName({ taskType, name: trimmed, dateStamp: stamp });
    return {
      workspace,
      branch: deriveBranchName(workspace, "", stamp),
      // Asking for `workspace` is not the fallback firing.
      collapsed: sanitizeSlug(trimmed) === "workspace" && !/workspace/i.test(trimmed),
    };
  }, [name, taskType]);

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
    setResult(null);

    const response = await postJson<QuickCreateResponse>("/api/workspaces", {
      name: name.trim(),
      taskType,
      repositories: chosen,
      ...(note.trim() ? { note: note.trim() } : {}),
    });

    if (!response.ok) {
      setFailure(response.error);
      return;
    }

    setResult(response.data);
    // A clean run has nothing left to read here. Anything that failed is the
    // one thing worth staying for, so that case reports instead of navigating.
    if (response.data.problems.length === 0) {
      router.push(`/workspace/${encodeURIComponent(response.data.workspace)}`);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div>
        <label htmlFor="quick-name" className="mb-1 block text-xs font-medium">
          Name
        </label>
        <Input
          id="quick-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. login-crash"
          className="w-full"
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Becomes the README title verbatim. Its ASCII slug names the workspace directory and
          every branch.
        </p>
        {preview && (
          <div className="mt-1 space-y-0.5 text-xs">
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

      <div>
        <label htmlFor="quick-note" className="mb-1 block text-xs font-medium">
          Note (optional)
        </label>
        <Textarea
          id="quick-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Goes into the README's Initial Request. Nothing reads it until you ask."
          rows={3}
        />
      </div>

      <Button onClick={create} disabled={!name.trim() || chosen.length === 0}>
        Create workspace
      </Button>

      {failure && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {failure}
        </div>
      )}

      {result && result.problems.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <p>
            Workspace{" "}
            <Link
              href={`/workspace/${encodeURIComponent(result.workspace)}`}
              className="font-medium underline"
            >
              {result.workspace}
            </Link>{" "}
            was created, but {result.problems.length} repositor
            {result.problems.length === 1 ? "y" : "ies"} could not be set up. Only the worktrees
            that exist are declared in its README.
          </p>
          <ul className="space-y-1">
            {result.problems.map((problem) => (
              <li key={problem.repository} className="font-mono text-xs">
                {problem.repository}: {problem.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
