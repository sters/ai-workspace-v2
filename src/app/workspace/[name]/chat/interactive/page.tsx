"use client";

import { use } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useChatHandoff } from "@/hooks/use-chat-handoff";
import { ChatTerminal } from "@/components/workspace/chat-terminal";

export default function ChatInteractivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Interactive Chat - ${decodedName}`);
  const { handoff, terminalKey, onHandoffDelivered } = useChatHandoff(decodedName);

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal
        key={terminalKey}
        workspaceId={decodedName}
        reviewTimestamp={handoff?.reviewTimestamp}
        researchChat={handoff?.researchChat}
        task={handoff?.task}
        discussion={handoff?.discussion}
        onHandoffDelivered={onHandoffDelivered}
      />
    </div>
  );
}
