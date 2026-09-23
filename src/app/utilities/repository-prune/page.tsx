import { PageHeader } from "@/components/shared/feedback/page-header";
import { RepositoryPruneList } from "@/components/utilities/repository-prune-list";

export default function RepositoryPrunePage() {
  return (
    <div>
      <PageHeader
        title="Repository Prune"
        description="Delete cloned repositories from repositories/. A clone any workspace still has a worktree of cannot be selected."
      />
      <RepositoryPruneList />
    </div>
  );
}
