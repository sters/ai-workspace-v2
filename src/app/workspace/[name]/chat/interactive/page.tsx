"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ChatTerminal } from "@/components/workspace/chat-terminal";

export default function ChatInteractivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const searchParams = useSearchParams();
  const reviewTimestamp = searchParams.get("reviewTimestamp") ?? undefined;
  const researchChat = searchParams.get("researchChat") === "1" || undefined;

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal workspaceId={decodedName} reviewTimestamp={reviewTimestamp} researchChat={researchChat} />
    </div>
  );
}
