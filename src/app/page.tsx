"use client";

import { Suspense, useState } from "react";
import { WorkspaceList } from "@/components/dashboard/workspace-list";
import { WorkspaceSearch } from "@/components/dashboard/workspace-search";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

function DashboardContent() {
  useDocumentTitle("Dashboard");
  const [searchActive, setSearchActive] = useState(false);

  return (
    <div>
      <PageHeader title="Workspaces" />

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
