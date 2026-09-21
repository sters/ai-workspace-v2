"use client";

import { useMemo, useState } from "react";
import { Input } from "./input";
import { Spinner } from "@/components/shared/feedback";
import { useRepositories } from "@/hooks/use-repositories";

/** Past this many rows the list needs narrowing to be usable. */
const FILTER_THRESHOLD = 8;

/**
 * The already-cloned repositories, as a multi-select. It owns the listing and
 * the filter; the caller owns which paths are ticked, since what a picked
 * repository *means* differs between callers — quick create sets up a worktree
 * per pick, while `/new` folds them into the description an init run reads.
 */
export function RepositoryPicker({
  selected,
  onToggle,
  disabled,
  emptyHint,
}: {
  selected: string[];
  onToggle: (repoPath: string) => void;
  disabled?: boolean;
  /** What to do instead when nothing has been cloned yet. */
  emptyHint: string;
}) {
  const { repositories, isLoading, error } = useRepositories();
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle
      ? repositories.filter((repo) => repo.repoPath.toLowerCase().includes(needle))
      : repositories;
  }, [repositories, filter]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Repositories</span>
        {repositories.length > FILTER_THRESHOLD && (
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
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Failed to list repositories: {String(error)}
        </p>
      )}
      {!isLoading && repositories.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
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
              onChange={() => onToggle(repo.repoPath)}
              disabled={disabled}
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
    </div>
  );
}
