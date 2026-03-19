/**
 * Client-side API calls for chat sessions.
 */

import type { z } from "zod";
import type { chatSessionKillSchema } from "@/lib/schemas";
import { postJson } from "./client";

export type KillChatSessionParams = z.input<typeof chatSessionKillSchema>;

/** Kill a chat session by ID. */
export async function killChatSession(sessionId: string): Promise<void> {
  await postJson("/api/chat-sessions/kill", { sessionId } satisfies KillChatSessionParams);
}
