"use client";

import { useState } from "react";
import { WorkspaceList } from "@/components/dashboard/workspace-list";
import { WorkspaceSearch } from "@/components/dashboard/workspace-search";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function DashboardPage() {
  const [searchActive, setSearchActive] = useState(false);

  return (
    <div>
      <PageHeader title="Workspaces" />

      <WorkspaceSearch onSearchActiveChange={setSearchActive} />

      {!searchActive && <WorkspaceList />}
    </div>
  );
}
