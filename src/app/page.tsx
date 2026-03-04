import Link from "next/link";
import { WorkspaceList } from "@/components/dashboard/workspace-list";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Workspaces"
        action={
          <Link
            href="/new"
            className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New Workspace
          </Link>
        }
      />

      <WorkspaceList />
    </div>
  );
}
