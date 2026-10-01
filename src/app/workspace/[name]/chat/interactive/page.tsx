"use client";

import { use, useCallback, useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ChatTerminal } from "@/components/workspace/chat-terminal";
import { clearChatHandoff, peekChatHandoff } from "@/lib/chat-handoff";

export default function ChatInteractivePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);
  useDocumentTitle(`Interactive Chat - ${decodedName}`);
  // What the page that navigated here asked for — a task, a draft, a chat
  // variant. Read without consuming, and cleared only once a session has it,
  // so a reload before then still applies it and a reload after resumes.
  const [handoff] = useState(() =>
    typeof window === "undefined" ? null : peekChatHandoff(decodedName),
  );
  const onHandoffDelivered = useCallback(() => clearChatHandoff(decodedName), [decodedName]);

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal
        workspaceId={decodedName}
        reviewTimestamp={handoff?.reviewTimestamp}
        researchChat={handoff?.researchChat}
        task={handoff?.task}
        discussion={handoff?.discussion}
        draft={handoff?.draft}
        onHandoffDelivered={handoff ? onHandoffDelivered : undefined}
      />
    </div>
  );
}
