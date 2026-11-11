"use client";

import { useState } from "react";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { MarkdownRenderer } from "@/components/shared/content/markdown-renderer";
import { StatusText } from "@/components/shared/feedback/status-text";
import { showToast } from "@/components/shared/feedback/toast";
import { cn } from "@/lib/utils";
import type { LessonStatus, RepoLesson } from "@/types/repo-lessons";

async function patchLesson(id: string, body: { status?: LessonStatus; text?: string }) {
  const res = await fetch(`/api/repo-lessons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
}

function LessonRow({
  lesson,
  byId,
  onChanged,
}: {
  lesson: RepoLesson;
  byId: Map<string, RepoLesson>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);

  const act = (body: { status?: LessonStatus; text?: string }) =>
    patchLesson(lesson.id, body)
      .then(() => {
        setEditing(false);
        onChanged();
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : "Update failed", "error"));

  return (
    <li className="space-y-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{lesson.section}</span>
        <span className="truncate">{lesson.sourceWorkspace}</span>
        <span>{lesson.createdAt.slice(0, 10)}</span>
        <div className="ml-auto flex gap-1.5">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => act({ text })} disabled={!text.trim()}>
                Save
              </Button>
              <Button variant="outline-muted" onClick={() => { setText(lesson.text); setEditing(false); }}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {lesson.status !== "approved" && (
                <Button variant="outline" onClick={() => act({ status: "approved" })}>
                  Approve
                </Button>
              )}
              {lesson.status !== "rejected" && (
                <Button variant="outline-muted" onClick={() => act({ status: "rejected" })}>
                  Reject
                </Button>
              )}
              {lesson.status === "rejected" && (
                <Button variant="outline-muted" onClick={() => act({ status: "candidate" })}>
                  Back to candidates
                </Button>
              )}
              <Button variant="outline-muted" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          autoFocus
        />
      ) : (
        <MarkdownRenderer content={lesson.text} />
      )}
      {lesson.replaces.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Replaces: {lesson.replaces.map((id) => byId.get(id)?.text ?? id).join(" / ")}
        </p>
      )}
      {lesson.evidence.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Evidence ({lesson.evidence.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {lesson.evidence.map((e, i) => (
              <li key={i}>
                {e.workspace !== lesson.sourceWorkspace && <span className="font-medium">{e.workspace}: </span>}
                {e.note}{" "}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer" className="underline">
                    link
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

const TABS: { status: LessonStatus; title: string; hint: string }[] = [
  { status: "candidate", title: "Candidates", hint: "Waiting for a decision. Nothing here reaches agents." },
  { status: "approved", title: "Approved", hint: "Given to the planner, executor and reviewers." },
  { status: "rejected", title: "Rejected", hint: "Never proposed again." },
];

export function RepoLessonsBrowser({ lessons, onChanged }: { lessons: RepoLesson[]; onChanged: () => void }) {
  const count = (status: LessonStatus) => lessons.filter((l) => l.status === status).length;
  const [selected, setSelected] = useState<LessonStatus>(
    () => TABS.find((t) => count(t.status) > 0)?.status ?? "candidate",
  );
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const shown = lessons.filter((l) => l.status === selected);
  const repos = [...new Set(shown.map((l) => l.repoKey))].sort();
  const repo = selectedRepo !== null && repos.includes(selectedRepo) ? selectedRepo : repos[0];
  const items = shown.filter((l) => l.repoKey === repo);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map(({ status, title }) => (
          <button
            key={status}
            role="tab"
            type="button"
            aria-selected={selected === status}
            onClick={() => setSelected(status)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm",
              selected === status
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {title} <span className="ml-1 rounded bg-muted px-1.5 text-xs">{count(status)}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{TABS.find((t) => t.status === selected)?.hint}</p>
      {repos.length === 0 ? (
        <StatusText>No lessons here.</StatusText>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <nav className="flex flex-col gap-0.5 md:sticky md:top-4 md:w-64 md:shrink-0">
            {repos.map((r) => (
              <button
                key={r}
                type="button"
                title={r}
                aria-current={r === repo ? "true" : undefined}
                onClick={() => setSelectedRepo(r)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs",
                  r === repo ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{r}</span>
                <span className="font-sans">{shown.filter((l) => l.repoKey === r).length}</span>
              </button>
            ))}
          </nav>
          <Card className="min-w-0 flex-1 space-y-3">
            <h2 className="break-all font-mono text-sm font-semibold">{repo}</h2>
            <ul>
              {items.map((l) => (
                <LessonRow key={`${l.id}:${l.updatedAt}`} lesson={l} byId={byId} onChanged={onChanged} />
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
