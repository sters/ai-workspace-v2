"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { SplitButton } from "../shared/buttons/split-button";
import { fetcher } from "@/lib/api";
import type { ChatStartPrompt } from "@/types/chat-start-prompt";

/**
 * Start Chat with a menu of the saved chat start prompts. The main button opens
 * the plain chat; a menu item starts a session that begins with that prompt.
 */
export function StartChatButton({
  label,
  onStart,
}: {
  label: string;
  onStart: (startPrompt?: string) => void | Promise<unknown>;
}) {
  const router = useRouter();
  const { data } = useSWR<{ prompts: ChatStartPrompt[] }>("/api/chat-start-prompts", fetcher);

  return (
    <SplitButton
      label={label}
      onClick={() => onStart()}
      items={[
        ...(data?.prompts ?? []).map((p) => ({ label: p.title, onClick: () => onStart(p.content) })),
        { label: "Manage start prompts…", onClick: () => router.push("/utilities/chat-start-prompts") },
      ]}
    />
  );
}
