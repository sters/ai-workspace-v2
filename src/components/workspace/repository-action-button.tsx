"use client";

import type { ReactNode } from "react";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";

/**
 * A button that optionally shows a per-repository dropdown.
 * When repositories are empty, renders a plain Button.
 * When repositories are provided, renders a SplitButton with one item per repo.
 */
export function RepositoryActionButton({
  label,
  onClick,
  disabled,
  repositories,
  onRepoClick,
}: {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  repositories?: { alias: string; path: string }[];
  onRepoClick: (repo: { alias: string; path: string }) => void;
}) {
  const repoItems = (repositories ?? []).map((repo) => ({
    label: repo.alias || repo.path.split("/").pop() || repo.path,
    onClick: () => onRepoClick(repo),
  }));

  if (repoItems.length === 0) {
    return (
      <Button
        variant="secondary"
        className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        onClick={onClick}
        disabled={disabled}
      >
        {label}
      </Button>
    );
  }

  return (
    <SplitButton
      label={label}
      onClick={onClick}
      variant="secondary"
      disabled={disabled}
      items={repoItems}
    />
  );
}
