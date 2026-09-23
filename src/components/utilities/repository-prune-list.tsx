"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/shared/buttons/button";
import { StatusText } from "@/components/shared/feedback/status-text";
import { useRepositoryPruneCandidates } from "@/hooks/use-repository-prune-candidates";
import { postJson } from "@/lib/api";
import type {
  RepositoryPruneCandidate,
  RepositoryPruneOutcome,
} from "@/types/repository-prune";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A clone is deletable only when something established that nothing uses it. */
function isDeletable(repo: RepositoryPruneCandidate): boolean {
  return repo.usedBy.length === 0 && !repo.usageError;
}

function formatLastReferenced(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const days = Math.floor((Date.now() - when.getTime()) / DAY_MS);
  const age = days <= 0 ? "today" : `${days}d ago`;
  return `${when.toLocaleString()} · ${age}`;
}

export function RepositoryPruneList() {
  const { repositories, isLoading, error, refresh } = useRepositoryPruneCandidates();
  const [selected, setSelected] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<RepositoryPruneOutcome[]>([]);
  const [failure, setFailure] = useState("");

  // A tick survives a refresh, so it is re-checked against the listing rather
  // than trusted: the clone may have gained a worktree since it was ticked.
  const ticked = useMemo(
    () =>
      repositories
        .filter((repo) => selected.includes(repo.repoPath) && isDeletable(repo))
        .map((repo) => repo.repoPath),
    [repositories, selected],
  );

  function toggle(repoPath: string) {
    setSelected((current) =>
      current.includes(repoPath)
        ? current.filter((p) => p !== repoPath)
        : [...current, repoPath],
    );
  }

  async function handleDelete() {
    if (ticked.length === 0) return;
    const confirmed = confirm(
      `Delete ${ticked.length} repository clone(s) from repositories/?\n\n${ticked.join("\n")}\n\n` +
        "They can be cloned again, but anything committed only there is gone.",
    );
    if (!confirmed) return;

    setFailure("");
    setOutcomes([]);
    const res = await postJson<{ outcomes: RepositoryPruneOutcome[] }>(
      "/api/repositories/prune",
      { repositories: ticked },
    );
    if (!res.ok) {
      setFailure(res.error);
      return;
    }
    setOutcomes(res.data.outcomes);
    setSelected([]);
    await refresh();
  }

  const inUse = repositories.filter((repo) => !isDeletable(repo)).length;

  return (
    <div>
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">Failed to list repositories: {String(error)}</StatusText>
      )}
      {!isLoading && !error && repositories.length === 0 && (
        <StatusText>Nothing has been cloned under repositories/ yet.</StatusText>
      )}

      {repositories.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-3">
            <Button variant="destructive" onClick={handleDelete} disabled={ticked.length === 0}>
              Delete {ticked.length} selected
            </Button>
            <span className="text-xs text-muted-foreground">
              {repositories.length} clone(s), {inUse} in use
            </span>
          </div>

          <div className="divide-y rounded-lg border">
            {repositories.map((repo) => (
              <label
                key={repo.repoPath}
                className={
                  isDeletable(repo)
                    ? "flex cursor-pointer items-start gap-2 p-2 text-sm hover:bg-accent"
                    : "flex items-start gap-2 p-2 text-sm"
                }
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={repo.repoPath}
                  checked={selected.includes(repo.repoPath)}
                  disabled={!isDeletable(repo)}
                  onChange={() => toggle(repo.repoPath)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="truncate font-mono">{repo.repoPath}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatLastReferenced(repo.lastReferencedAt)}
                    </span>
                  </span>
                  {repo.usedBy.length > 0 && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      in use by{" "}
                      {repo.usedBy
                        .map((usage) => usage.workspace || usage.worktreePath)
                        .join(", ")}
                    </span>
                  )}
                  {repo.usageError && (
                    <span className="mt-0.5 block text-xs text-destructive">
                      worktrees could not be listed, so nothing confirms it is unused:{" "}
                      {repo.usageError}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {failure && (
        <StatusText variant="error" className="mt-3">
          {failure}
        </StatusText>
      )}

      {outcomes.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border p-3 text-sm">
          {outcomes.map((outcome) => (
            <div key={outcome.repoPath} className="flex flex-wrap gap-x-2">
              <span
                className={
                  outcome.deleted
                    ? "font-semibold text-green-600 dark:text-green-400"
                    : "font-semibold text-destructive"
                }
              >
                {outcome.deleted ? "Deleted" : "Kept"}
              </span>
              <span className="font-mono">{outcome.repoPath}</span>
              {outcome.reason && (
                <span className="text-muted-foreground">{outcome.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
