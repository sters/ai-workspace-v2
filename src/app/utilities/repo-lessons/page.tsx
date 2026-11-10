"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/shared/containers/card";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { showToast } from "@/components/shared/feedback/toast";
import { fetcher } from "@/lib/api";
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
    <li className="space-y-1 border-b py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-xs">{lesson.section}</span>
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            autoFocus
          />
        ) : (
          <p className="flex-1 text-sm">{lesson.text}</p>
        )}
      </div>
      {lesson.replaces.length > 0 && (
        <p className="pl-2 text-xs text-muted-foreground">
          Replaces: {lesson.replaces.map((id) => byId.get(id)?.text ?? id).join(" / ")}
        </p>
      )}
      <ul className="pl-2 text-xs text-muted-foreground">
        {lesson.evidence.map((e, i) => (
          <li key={i}>
            {e.workspace}: {e.note}{" "}
            {e.url && (
              <a href={e.url} target="_blank" rel="noreferrer" className="underline">
                link
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 pl-2">
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
    </li>
  );
}

const GROUPS: { status: LessonStatus; title: string }[] = [
  { status: "candidate", title: "Candidates" },
  { status: "approved", title: "Approved — given to agents" },
  { status: "rejected", title: "Rejected — never proposed again" },
];

export default function RepoLessonsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ lessons: RepoLesson[] }>("/api/repo-lessons", fetcher);
  const lessons = data?.lessons ?? [];
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const repos = [...new Set(lessons.map((l) => l.repoKey))].sort();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader title="Repo Lessons" />
      <p className="text-sm text-muted-foreground">
        Distilled when a workspace is archived, from PR comments, commits people added after aiw, closed PRs and
        recurring review findings. Only approved lessons reach the planner, executor and reviewers.
      </p>
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to load lessons.</StatusText>}
      {!isLoading && !error && repos.length === 0 && <StatusText>No lessons yet.</StatusText>}
      {repos.map((repo) => (
        <Card key={repo} className="space-y-3">
          <h2 className="font-mono text-sm font-semibold">{repo}</h2>
          {GROUPS.map(({ status, title }) => {
            const items = lessons.filter((l) => l.repoKey === repo && l.status === status);
            if (items.length === 0) return null;
            return (
              <section key={status}>
                <h3 className="text-xs font-medium uppercase text-muted-foreground">
                  {title} ({items.length})
                </h3>
                <ul>
                  {items.map((l) => (
                    <LessonRow key={`${l.id}:${l.updatedAt}`} lesson={l} byId={byId} onChanged={() => void mutate()} />
                  ))}
                </ul>
              </section>
            );
          })}
        </Card>
      ))}
    </div>
  );
}
