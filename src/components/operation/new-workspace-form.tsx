"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { InitSplitButton } from "./init-split-button";
import { useStartChat } from "./start-chat";
import { StatusText } from "@/components/shared/feedback/status-text";
import { Input } from "@/components/shared/forms";
import { RepositoryPicker } from "@/components/shared/forms/repository-picker";
import { SnippetPicker } from "@/components/shared/forms/snippet-picker";
import { postJson } from "@/lib/api";
import { SELECTED_REPOS_HEADING, withSelectedRepositories } from "@/lib/task-description";
import type { OperationType } from "@/types/operation";

/** Repository paths or PR URLs as typed: whitespace- or comma-separated. */
function parseExtraRepositories(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

/** The routes answer a refusal with `{ error }`; anything else is shown as it came. */
function refusalReason(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const error = (parsed as { error?: unknown } | null)?.error;
    if (typeof error === "string" && error.trim()) return error;
  } catch {
    // Not JSON — the text is the best answer there is.
  }
  return raw;
}

export function NewWorkspaceForm({
  initialDescription = "",
}: {
  /** Handed over by another page, e.g. a suggestion's `?description=`. */
  initialDescription?: string;
}) {
  const { mutate } = useSWRConfig();
  const [description, setDescription] = useState(initialDescription);
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const repositories = useMemo(
    () => [...new Set([...selected, ...parseExtraRepositories(extra)])],
    [selected, extra],
  );
  const composed = useMemo(
    () => withSelectedRepositories(description, repositories),
    [description, repositories],
  );
  const chat = useStartChat({ note: description, repositories });

  const toggle = (repoPath: string) => {
    setSelected((prev) =>
      prev.includes(repoPath) ? prev.filter((p) => p !== repoPath) : [...prev, repoPath],
    );
  };

  const describe = (next: string) => {
    setDescription(next);
    setConfirmed(false);
    setError(null);
  };

  /**
   * The run is followed in the history below, so starting one leaves the form
   * ready for the next request rather than disabled around a log. The request
   * survives a refusal — it is the only copy of what the user wrote.
   */
  const start = async (type: OperationType, body: Record<string, string>) => {
    setError(null);
    setConfirmed(false);
    const res = await postJson(`/api/operations/${type}`, body);
    if (!res.ok) {
      setError(refusalReason(res.error));
      return;
    }
    setDescription("");
    setSelected([]);
    setExtra("");
    setConfirmed(true);
    mutate((key) => typeof key === "string" && key.startsWith("/api/operations"), undefined, {
      revalidate: true,
    });
  };

  return (
    <div className="w-full space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="new-description" className="text-xs font-medium">
            Task Description
          </label>
          <SnippetPicker
            onInsert={(content) =>
              describe(description.trim() ? `${description}\n\n${content}` : content)
            }
          />
        </div>
        <textarea
          id="new-description"
          value={description}
          onChange={(e) => describe(e.target.value)}
          placeholder={"e.g., Add retry logic to the payment service in github.com/org/payment-api\ne.g., https://example.atlassian.net/browse/PROJ-123 を実装する\ne.g., github.com/org/frontend と github.com/org/api に認証機能を追加"}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          rows={6}
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Start autonomous has Claude work out the task type, repositories and name, plan, and
          carry the work through. Start chat only creates the workspace and a branch per
          repository, keeps this text verbatim as the README&apos;s Initial Request, and hands it to
          an interactive chat — or, for a PR review, starts the review. A PR URL among the
          repositories checks out that PR&apos;s branch and may stand in for the text.
        </p>
      </div>

      <div>
        <RepositoryPicker
          selected={selected}
          onToggle={toggle}
          emptyHint="No repository has been cloned yet. Add one below and it will be cloned."
        />

        <div className="mt-2">
          <label htmlFor="new-extra" className="mb-1 block text-xs font-medium">
            Add repository
          </label>
          <Input
            id="new-extra"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="github.com/org/repo or https://github.com/org/repo/pull/123 — separate several with spaces"
            className="w-full"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Not cloned yet, the same repository twice with a <code>:alias</code> suffix for a
            second worktree, or a PR URL. Start autonomous appends these and the ticked ones to
            the description under <code className="font-mono">{SELECTED_REPOS_HEADING}</code>, so
            for it a repository named in the description works just as well; Start chat needs at
            least one here.
          </p>
        </div>
      </div>

      {chat.options}

      <div className="flex flex-wrap items-center gap-2">
        <InitSplitButton description={composed} start={start} />
        {chat.button}
      </div>

      {chat.feedback}

      {error && <StatusText variant="error">Failed to start: {error}</StatusText>}
      {confirmed && <StatusText>Started — it is listed under Recent New Operations below.</StatusText>}
    </div>
  );
}
