"use client";

import useSWR from "swr";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { RepoLessonsBrowser } from "@/components/utilities/repo-lessons-browser";
import { fetcher } from "@/lib/api";
import type { RepoLesson } from "@/types/repo-lessons";

export default function RepoLessonsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ lessons: RepoLesson[] }>("/api/repo-lessons", fetcher);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHeader title="Repo Lessons" />
      <p className="text-sm text-muted-foreground">
        Distilled when a workspace is archived, from PR comments, commits people added after aiw, closed PRs and
        recurring review findings. Only approved lessons reach the planner, executor and reviewers.
      </p>
      {isLoading && <StatusText>Loading...</StatusText>}
      {error && <StatusText variant="error">Failed to load lessons.</StatusText>}
      {data && data.lessons.length === 0 && <StatusText>No lessons yet.</StatusText>}
      {data && data.lessons.length > 0 && <RepoLessonsBrowser lessons={data.lessons} onChanged={() => void mutate()} />}
    </div>
  );
}
