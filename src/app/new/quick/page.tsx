import { QuickCreateForm } from "@/components/operation/quick-create-form";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function QuickWorkspacePage() {
  return (
    <div>
      <PageHeader
        title="New Workspace (Quick)"
        description="Pick repositories and get worktrees. No agent runs: no README analysis, no TODO planning, no constraint discovery — just the workspace, a template README declaring what you picked, and a branch per repository. Open a terminal in a worktree and work by hand, or start an operation later from the workspace page."
      />

      <QuickCreateForm />
    </div>
  );
}
