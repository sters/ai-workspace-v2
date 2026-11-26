import { useParams } from "@/lib/router/navigation";
import { useCallback, useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ChatTerminal } from "@/components/workspace/chat-terminal";
import { clearChatHandoff, peekChatHandoff } from "@/lib/chat-handoff";

export default function ChatInteractivePage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Interactive Chat - ${name}`);
  // What the page that navigated here asked for — a task, a topic, a chat
  // variant. Read without consuming, and cleared only once a session has it,
  // so a reload before then still applies it and a reload after resumes.
  const [handoff] = useState(() =>
    typeof window === "undefined" ? null : peekChatHandoff(name),
  );
  const onHandoffDelivered = useCallback(() => clearChatHandoff(name), [name]);

  return (
    <div className="h-[calc(100vh-24rem)]">
      <ChatTerminal
        workspaceId={name}
        reviewTimestamp={handoff?.reviewTimestamp}
        researchChat={handoff?.researchChat}
        task={handoff?.task}
        discussion={handoff?.discussion}
        onHandoffDelivered={handoff ? onHandoffDelivered : undefined}
      />
    </div>
  );
}
