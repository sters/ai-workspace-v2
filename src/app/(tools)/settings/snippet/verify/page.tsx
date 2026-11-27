import { SnippetsManager } from "@/components/utilities/snippets-manager";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SnippetVerifyPage() {
  useDocumentTitle("Snippet: Verify");
  return (
    <SnippetsManager
      kind="verify"
      title="Snippet: Verify"
      description="Save and manage reusable instructions for verification requests."
      placeholder="Snippet content to insert into a verification request..."
    />
  );
}
