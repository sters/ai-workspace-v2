"use client";

import { Button, Callout } from "@/components/shared";
import type { OpenPullRequestInfo } from "@/hooks/use-archive-toggle";

export function ArchiveOpenPrsConfirm({
  prs,
  onConfirm,
  onCancel,
}: {
  prs: OpenPullRequestInfo[];
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}) {
  return (
    <Callout variant="warning" className="space-y-2 text-sm">
      <p className="font-medium">
        This workspace still has {prs.length} open pull request{prs.length === 1 ? "" : "s"}.
        Archiving closes {prs.length === 1 ? "it" : "them"} and deletes the branch{prs.length === 1 ? "" : "es"}.
      </p>
      <ul className="list-disc pl-5">
        {prs.map((pr) => (
          <li key={pr.url}>
            {pr.repoName}:{" "}
            <a href={pr.url} target="_blank" rel="noreferrer" className="underline">
              {pr.title}
            </a>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="destructive" onClick={onConfirm}>
          Close PRs and archive
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Callout>
  );
}
