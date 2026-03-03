"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ChatTerminal } from "@/components/workspace/chat-terminal";

export default function WorkspaceChatPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  const searchParams = useSearchParams();
  const reviewTimestamp = searchParams.get("reviewTimestamp") ?? undefined;

  return (
    <div className="h-[calc(100vh-20rem)]">
      <ChatTerminal workspaceId={decodedName} reviewTimestamp={reviewTimestamp} />
    </div>
  );
}
