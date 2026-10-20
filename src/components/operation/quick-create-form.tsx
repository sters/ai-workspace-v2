"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/shared/buttons";
import { Input, Textarea } from "@/components/shared/forms";
import { RepositoryPicker } from "@/components/shared/forms/repository-picker";
import { Spinner } from "@/components/shared/feedback";
import { postJson } from "@/lib/api";
import { chatPagePath, stashChatHandoff } from "@/lib/chat-handoff";
import { parsePrUrl } from "@/lib/github-pr-url";
import {
  dateStamp,
  deriveBranchName,
  quickWorkspaceName,
  sanitizeSlug,
  workspaceDirName,
} from "@/lib/naming";
import type { SetupRepositoryResult } from "@/types/pipeline";
import { useQuickCreates } from "@/hooks/use-quick-creates";
import type { QuickCreateProgress, QuickCreateStart } from "@/types/workspace";

/** The default first, since it is also the dropdown's initial value. */
const TASK_TYPES = ["feature", "bugfix", "research", "review"] as const;

interface QuickCreateResponse {
  workspace: string;
  workspacePath: string;
  repositories: SetupRepositoryResult[];
  pullRequests: { url: string; repoPath: string; headBranch: string }[];
  problems: { repository: string; error: string }[];
  log: string[];
  /** Started by the server, so it runs whether or not this form is still open. */
  start: QuickCreateStart;
}

/** Repository paths or PR URLs as typed: whitespace- or comma-separated. */
function parseExtraRepositories(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

/**
 * Hand the note to the chat as its task, for the chat started by hand when the
 * server's start did not happen. It travels as a chat handoff rather than in
 * the URL, so its length is not capped by a query string, and the chat page
 * clears it once a session has it — a reload then resumes that session rather
 * than starting the work again.
 */
function handOverToChat(workspace: string, task: string): string {
  if (task) stashChatHandoff(workspace, { task });
  return chatPagePath(workspace);
}

function operationHref(workspace: string, operationId: string): string {
  return `/workspace/${encodeURIComponent(workspace)}/operations?${new URLSearchParams({ operationId })}`;
}

export function QuickCreateForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]>("feature");
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState("");
  /**
   * A workspace whose repositories did not all set up, or whose chat or review
   * did not start, with the note as it read when it was sent: the textarea
   * stays editable afterwards, and the chat link must carry the request the
   * README was written from. A clean create never renders this — it is already
   * on its way to the chat or the review.
   */
  const [created, setCreated] = useState<{
    response: QuickCreateResponse;
    task: string;
  } | null>(null);
  /**
   * Whether the user is still here when the create returns. The server has
   * already started what follows, so a user who left loses nothing by not
   * being pulled back to it.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * `sent` is terminal, and it is what stops a second workspace being created.
   * The in-flight click is already swallowed by `Button`, but the success path
   * navigates with `router.push`, which leaves this form mounted and clickable
   * until the new route renders — and a POST landing in that window creates a
   * whole second workspace (`setupWorkspace` gives the collision a `-2`), not a
   * retry. Only a request the server *refused* returns to `idle`, since that is
   * the one answer that says nothing was created.
   */
  const [status, setStatus] = useState<"idle" | "creating" | "sent">("idle");

  /**
   * The server's record of creates, this form's own included. One still
   * running — sent from here, or from this form before the user left it —
   * keeps the button disabled for the same reason `sent` does.
   */
  const { quickCreates } = useQuickCreates({ polling: status === "creating" });
  const running = quickCreates.find((q) => q.state === "running");
  /**
   * Creates this form saw running. Only those are reported once they finish:
   * one that ended before the form opened is old news, and the user already
   * went wherever it led.
   */
  const [watched, setWatched] = useState<string[]>([]);
  const newlyRunning = quickCreates.filter((q) => q.state === "running" && !watched.includes(q.id));
  if (newlyRunning.length > 0) setWatched([...watched, ...newlyRunning.map((q) => q.id)]);
  /**
   * This form's own create reports through its response, and the button is
   * only enabled while no other create runs — so once a response arrives,
   * every create this form watched is either that one or long over.
   */
  const [answered, setAnswered] = useState(false);
  const finished =
    status === "idle" && !answered
      ? quickCreates.find((q) => q.state !== "running" && watched.includes(q.id))
      : undefined;

  const chosen = useMemo(
    () => [...new Set([...selected, ...parseExtraRepositories(extra)])],
    [selected, extra],
  );

  /** What the workspace ends up called: the typed name, or the note's first line. */
  const effectiveName = useMemo(() => quickWorkspaceName(name, note), [name, note]);
  const hasPr = useMemo(() => chosen.some((repo) => parsePrUrl(repo) !== null), [chosen]);
  /** The PR's title is read server-side, so it names the workspace when nothing here does. */
  const namedFromPr = !effectiveName && hasPr;
  /**
   * What the form promises; the server's `pullRequests` decides, since a PR
   * that could not be read leaves nothing to review.
   */
  const reviewsOnCreate = taskType === "review" && hasPr;

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
      setAnswered(true);
      // The request never came back, so whether it created anything is unknown.
      // Staying disabled is the safe half of that: a blind retry is how the
      // duplicate gets made.
      setStatus("sent");
      setFailure(
        `${String(err)} — the workspace may still have been created. Check the dashboard before creating it again.`,
      );
      return;
    }

    setAnswered(true);
    if (!response.ok) {
      setStatus("idle");
      setFailure(response.error);
      return;
    }

    setStatus("sent");
    if (!mounted.current) return;
    const { workspace, problems, start } = response.data;
    // A repository that failed is the one thing worth reading first, so that
    // case reports instead of navigating — and the server started nothing.
    if (problems.length > 0 || start.kind === "failed") {
      setCreated({ response: response.data, task: note.trim() });
      return;
    }
    router.push(
      start.kind === "review" ? operationHref(workspace, start.operationId) : chatPagePath(workspace),
    );
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
          Kept verbatim in the README&apos;s Initial Request, and handed to the chat this opens as
          its request, which starts on it straight away. Optional when a PR URL is among the
          repositories: its title and description are recorded instead.
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
        {namedFromPr && (
          <p className="mt-1 text-xs text-muted-foreground">
            Named from the PR&apos;s title, which is read when the workspace is created.
          </p>
        )}
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
            {hasPr && (
              <p className="text-muted-foreground">
                A PR&apos;s worktree checks out the PR&apos;s own branch instead.
              </p>
            )}
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
        {taskType === "review" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {hasPr
              ? "Starts a review of the PR once the workspace exists, instead of a chat."
              : "Add a PR URL below to have it reviewed on creation; without one this opens a chat."}
          </p>
        )}
      </div>

      <div>
        <RepositoryPicker
          selected={selected}
          onToggle={toggle}
          emptyHint="No repository has been cloned yet. Type a path below and it will be cloned."
        />

        <div className="mt-2">
          <label htmlFor="quick-extra" className="mb-1 block text-xs font-medium">
            Add repository
          </label>
          <Input
            id="quick-extra"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="github.com/org/repo or https://github.com/org/repo/pull/123 — separate several with spaces"
            className="w-full"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Not cloned yet, the same repository twice with a <code>:alias</code> suffix for a
            second worktree, or a PR URL to check out that PR&apos;s branch.
          </p>
        </div>
      </div>

      <Button
        onClick={create}
        disabled={
          (!effectiveName && !hasPr) || chosen.length === 0 || status !== "idle" || running !== undefined
        }
      >
        {status === "creating" || running ? (
          <>
            <Spinner />
            Creating workspace…
          </>
        ) : reviewsOnCreate ? (
          "Create workspace and review"
        ) : (
          "Create workspace"
        )}
      </Button>

      {running && <QuickCreateLog progress={running} />}

      {finished && <FinishedQuickCreate progress={finished} />}

      {failure && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {failure}
        </div>
      )}

      {created && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {created.response.start.kind === "failed" ? (
            <p>
              Workspace <code className="font-mono">{created.response.workspace}</code> was created,
              but its {created.response.start.what} could not start: {created.response.start.error}
            </p>
          ) : (
            <>
              <p>
                Workspace <code className="font-mono">{created.response.workspace}</code> was
                created, but {created.response.problems.length} repositor
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
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={chatPagePath(created.response.workspace)}
              onClick={() => handOverToChat(created.response.workspace, created.task)}
              className="font-medium underline"
            >
              Start a chat on it anyway
            </Link>
            <Link
              href={`/workspace/${encodeURIComponent(created.response.workspace)}`}
              className="underline"
            >
              Open the workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** The tail of a running create's setup output: git is the slow part, and it says where it is. */
function QuickCreateLog({ progress }: { progress: QuickCreateProgress }) {
  return (
    <div aria-live="polite" className="space-y-1 rounded-md border p-2 text-xs">
      <p className="font-medium">
        Creating{" "}
        {progress.workspace ? <code className="font-mono">{progress.workspace}</code> : progress.name}
        …
      </p>
      {progress.log.length > 0 && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">
          {progress.log.slice(-30).join("\n")}
        </pre>
      )}
    </div>
  );
}

/**
 * A create this form watched run without having sent it: the user left and
 * came back. The server already started what follows, so this offers the way
 * there rather than going.
 */
function FinishedQuickCreate({ progress }: { progress: QuickCreateProgress }) {
  if (progress.state === "failed" || !progress.workspace) {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        Creating {progress.name} failed: {progress.error}
      </div>
    );
  }
  const { workspace, start } = progress;
  const clean = !progress.problems && start?.kind !== "failed";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2 text-sm">
      <span>
        Workspace <code className="font-mono">{workspace}</code> was created
        {clean
          ? "."
          : start?.kind === "failed"
            ? `, but its ${start.what} could not start: ${start.error}`
            : `, but ${progress.problems} repositor${progress.problems === 1 ? "y" : "ies"} could not be set up.`}
      </span>
      {start?.kind === "review" ? (
        <Link href={operationHref(workspace, start.operationId)} className="font-medium underline">
          Open its review
        </Link>
      ) : clean ? (
        <Link href={chatPagePath(workspace)} className="font-medium underline">
          Open its chat
        </Link>
      ) : null}
      <Link href={`/workspace/${encodeURIComponent(workspace)}`} className="underline">
        Open the workspace
      </Link>
    </div>
  );
}
