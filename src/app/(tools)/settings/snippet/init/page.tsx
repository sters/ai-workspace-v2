import { SnippetsManager } from "@/components/utilities/snippets-manager";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SnippetInitPage() {
  useDocumentTitle("Snippet: Init");
  return (
    <SnippetsManager
      kind="init"
      title="Snippet: Init"
      description="Save and manage reusable text snippets for workspace descriptions."
      placeholder="Snippet content to insert into workspace description..."
    />
  );
}
