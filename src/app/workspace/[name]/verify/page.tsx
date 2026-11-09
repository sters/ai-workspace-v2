"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { VerificationBrowser } from "@/components/workspace/verification-browser";

export default function WorkspaceVerifyPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Verify - ${decodedName}`);

  return <VerificationBrowser workspaceName={decodedName} />;
}
