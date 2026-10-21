/**
 * A WebUI chat that continues a Slack thread's conversation. A thread bound to
 * a workspace by `ws` runs its turns as one Claude CLI session; the chat
 * resumes that same session interactively, so the thread and the chat never
 * hold separate contexts over one set of worktrees.
 *
 * One side drives the session at a time: a Slack turn in flight refuses the
 * chat here, and a live chat refuses the Slack turn
 * (`slack-server/webui-attach.ts`).
 */

import { getConfig } from "@/lib/config";
import { getSession } from "@/lib/db/slack-sessions";
import {
  findWorkspaceThread,
  getThreadTurnStartedAt,
  getThreadWorkspace,
} from "@/lib/db/slack-thread-workspaces";

/**
 * Whether the Slack bot is running a turn on the thread. A marker older than
 * two turn caps (a turn plus the one fresh retry `converse` makes) was left by
 * a bot that stopped mid-turn, and blocks nothing.
 */
export function isSlackTurnInFlight(threadKey: string, now: number): boolean {
  const startedAt = getThreadTurnStartedAt(threadKey);
  return startedAt !== undefined && now - startedAt < 2 * getConfig().slack.chatMaxTurnMs;
}

export type SlackThreadResolution = { ok: true; cliSessionId: string } | { ok: false; error: string };

/** The CLI session a chat on `workspaceId` may resume for the thread, or why it may not. */
export function resolveSlackThread(threadKey: string, workspaceId: string, now: number): SlackThreadResolution {
  if (getThreadWorkspace(threadKey) !== workspaceId) {
    return { ok: false, error: `That Slack thread does not work in "${workspaceId}".` };
  }
  const cliSessionId = getSession(threadKey, now);
  if (!cliSessionId) {
    return { ok: false, error: "The Slack conversation has no session to continue: it never ran a turn, or it expired." };
  }
  if (isSlackTurnInFlight(threadKey, now)) {
    return { ok: false, error: "Slack is answering in that thread right now. Try again once its reply is posted." };
  }
  return { ok: true, cliSessionId };
}

export interface WorkspaceSlackThread {
  threadKey: string;
  /** Link to the thread in Slack; absent when it could not be fetched at binding. */
  permalink?: string;
  /** The conversation has a CLI session a chat can resume. */
  resumable: boolean;
  turnInFlight: boolean;
}

/** The Slack thread working in `workspaceId`: the workspace header links to it, the chat page offers continuing it. */
export function findWorkspaceSlackThread(workspaceId: string, now: number): WorkspaceSlackThread | null {
  const thread = findWorkspaceThread(workspaceId);
  if (!thread) return null;
  const { threadKey } = thread;
  return {
    ...thread,
    resumable: getSession(threadKey, now) !== undefined,
    turnInFlight: isSlackTurnInFlight(threadKey, now),
  };
}
