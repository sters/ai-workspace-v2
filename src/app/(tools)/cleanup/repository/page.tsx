import { PageHeader } from "@/components/shared/feedback/page-header";
import { RepositoryPruneList } from "@/components/utilities/repository-prune-list";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function RepositoryPrunePage() {
  useDocumentTitle("Cleanup: Repository");
  return (
    <div>
      <PageHeader
        title="Cleanup: Repository"
        description="Delete cloned repositories from repositories/. A clone any workspace still has a worktree of cannot be selected."
      />
      <RepositoryPruneList />
    </div>
  );
}
