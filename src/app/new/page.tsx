"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NewOperationsHistory } from "@/components/operation/new-operations-history";
import { NewWorkspaceForm } from "@/components/operation/new-workspace-form";
import { PageHeader } from "@/components/shared/feedback/page-header";

function NewWorkspacePageContent() {
  const searchParams = useSearchParams();

  return (
    <div>
      <PageHeader
        title="New Workspace"
        description="Describe the task, ticket, or feature. Claude will determine the task type, repositories, and workspace name automatically."
      />

      <NewWorkspaceForm initialDescription={searchParams.get("description") ?? ""} />

      <hr className="my-8 border-border" />

      <NewOperationsHistory />
    </div>
  );
}

export default function NewWorkspacePage() {
  return (
    <Suspense>
      <NewWorkspacePageContent />
    </Suspense>
  );
}
