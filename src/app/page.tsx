"use client";

import { Suspense, useState } from "react";
import { WorkspaceList } from "@/components/dashboard/workspace-list";
import { WorkspaceSearch } from "@/components/dashboard/workspace-search";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import Link from "next/link";
import useSWR from "swr";
import { Callout } from "@/components/shared/containers/callout";
import { fetcher } from "@/lib/api";

function LessonCandidatesNotice() {
  const { data } = useSWR<{ candidates: number }>("/api/repo-lessons?count=candidates", fetcher);
  if (!data?.candidates) return null;
  return (
    <Callout variant="info" className="mb-4 text-sm">
      {data.candidates} repository lesson{data.candidates === 1 ? "" : "s"} waiting for review —{" "}
      <Link href="/utilities/repo-lessons" className="underline">
        Repo Lessons
      </Link>
    </Callout>
  );
}

function PrSuggestionsNotice() {
  const { data } = useSWR<{ workspaces: string[] }>("/api/pr-suggestions", fetcher, { refreshInterval: 60_000 });
  if (!data?.workspaces.length) return null;
  return (
    <Callout variant="info" className="mb-4 text-sm">
      Suggested actions on pull requests:{" "}
      {data.workspaces.map((name, i) => (
        <span key={name}>
          {i > 0 && ", "}
          <Link href={`/workspace/${encodeURIComponent(name)}/pull-requests`} className="underline">
            {name}
          </Link>
        </span>
      ))}
    </Callout>
  );
}

function DashboardContent() {
  useDocumentTitle("Dashboard");
  const [searchActive, setSearchActive] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Workspaces" />

      <LessonCandidatesNotice />
      <PrSuggestionsNotice />

      <WorkspaceSearch onSearchActiveChange={setSearchActive} />

      {!searchActive && <WorkspaceList />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
