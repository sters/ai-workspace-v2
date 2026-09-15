import { QuickCreateForm } from "@/components/operation/quick-create-form";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function QuickWorkspacePage() {
  return (
    <div>
      <PageHeader
        title="New Workspace (Quick)"
        description="Pick repositories and get worktrees. Creating it plans nothing: no README analysis, no TODO planning, no constraint discovery — just the workspace, a template README declaring what you picked, and a branch per repository. It then opens an interactive chat with your note typed into the prompt, ready for you to send; untick that to land on the workspace page with nothing running."
      />

      <QuickCreateForm />
    </div>
  );
}
