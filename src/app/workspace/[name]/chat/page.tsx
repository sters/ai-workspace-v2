"use client";

import { use } from "react";
import { ChatTerminal } from "@/components/workspace/chat-terminal";

export default function WorkspaceChatPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);

  return (
    <div className="h-[calc(100vh-20rem)]">
      <ChatTerminal workspaceId={decodedName} />
    </div>
  );
}
