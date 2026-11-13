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

function LessonReviewNotice() {
  const { data } = useSWR<{ candidates: number; disputed: number }>("/api/repo-lessons?count=review", fetcher);
  if (!data?.candidates && !data?.disputed) return null;
  const parts = [
    data.candidates > 0 && `${data.candidates} repository lesson${data.candidates === 1 ? "" : "s"} waiting for review`,
    data.disputed > 0 && `${data.disputed} approved lesson${data.disputed === 1 ? "" : "s"} disputed`,
  ].filter(Boolean);
  return (
    <Callout variant="info" className="mb-4 text-sm">
      {parts.join(", ")} —{" "}
      <Link href="/utilities/repo-lessons" className="underline">
        Repo Lessons
      </Link>
    </Callout>
  );
}

function DashboardContent() {
  useDocumentTitle("Dashboard");
  const [searchActive, setSearchActive] = useState(false);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Workspaces" />

      <LessonReviewNotice />

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
