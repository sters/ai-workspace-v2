"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ChatTerminal } from "@/components/workspace/chat-terminal";

export default function ChatInteractivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Interactive Chat - ${decodedName}`);
  const searchParams = useSearchParams();
  const reviewTimestamp = searchParams.get("reviewTimestamp") ?? undefined;
  const researchChat = searchParams.get("researchChat") === "1" || undefined;
  // A draft to type into the prompt box, unsent — quick-create hands over the
  // task description this way. Only ever applied to a freshly started session,
  // so reloading this URL resumes the existing one and seeds nothing.
  const seedInput = searchParams.get("seed") ?? undefined;

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal workspaceId={decodedName} reviewTimestamp={reviewTimestamp} researchChat={researchChat} seedInput={seedInput} />
    </div>
  );
}
