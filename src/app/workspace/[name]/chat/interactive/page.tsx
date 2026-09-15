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
  // What the session should get on with — quick create hands its note over
  // this way. Only ever applied to a session this mount starts, so reloading
  // the URL resumes the running one rather than starting the work again.
  const task = searchParams.get("task") ?? undefined;

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal workspaceId={decodedName} reviewTimestamp={reviewTimestamp} researchChat={researchChat} task={task} />
    </div>
  );
}
