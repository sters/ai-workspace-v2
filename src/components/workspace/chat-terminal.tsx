"use client";

import useSWR from "swr";
import { useChatSession } from "@/hooks/use-chat-session";
import { fetcher } from "@/lib/api";
import type { WorkspaceSlackThread } from "@/lib/chat-server/slack-thread";
import { Button } from "../shared/buttons/button";
import { StartChatButton } from "./start-chat-button";
import { StatusText } from "../shared/feedback/status-text";

export function ChatTerminal({
  workspaceId,
  initialPrompt,
  reviewTimestamp,
  researchChat,
  task,
  discussion,
  onHandoffDelivered,
}: {
  workspaceId: string;
  initialPrompt?: string;
  reviewTimestamp?: string;
  researchChat?: boolean;
  task?: string;
  discussion?: string;
  onHandoffDelivered?: () => void;
}) {
  const {
    containerRef,
    state,
    exitCode,
    error,
    openSession,
    continueSlackThread,
    cancelResume,
    stopSession,
  } = useChatSession(workspaceId, {
    initialPrompt,
    reviewTimestamp,
    researchChat,
    task,
    discussion,
    onHandoffDelivered,
  });

  // Polled so the button frees up once a Slack turn in flight finishes.
  const { data: slackData } = useSWR<{ slackThread: WorkspaceSlackThread | null }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/slack-thread`,
    fetcher,
    { refreshInterval: 10000 },
  );
  const slackThread = slackData?.slackThread;
  const continueSlackButton = slackThread && state !== "connecting" && state !== "resuming" && (
    <Button
      variant="secondary"
      disabled={!slackThread.resumable || slackThread.turnInFlight}
      title={
        !slackThread.resumable
          ? "The Slack conversation has no session to continue: it never ran a turn, or it expired."
          : slackThread.turnInFlight
            ? "Slack is answering in the thread right now."
            : "Resume the Slack thread's Claude session here. Slack waits until this session is stopped."
      }
      onClick={() => continueSlackThread(slackThread.threadKey)}
    >
      Continue Slack conversation
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {state === "idle" && (
          <StartChatButton label="Start Chat" onStart={openSession} />
        )}
        {state === "connecting" && (
          <StatusText>Connecting...</StatusText>
        )}
        {state === "resuming" && (
          <>
            <StatusText>Reconnecting...</StatusText>
            <Button variant="ghost" onClick={cancelResume}>Cancel</Button>
          </>
        )}
        {state === "running" && (
          <Button variant="destructive" onClick={stopSession}>Stop</Button>
        )}
        {state === "exited" && (
          <>
            <StatusText>
              Session ended{exitCode !== null ? ` (code ${exitCode})` : ""}
            </StatusText>
            <StartChatButton label="New Session" onStart={openSession} />
          </>
        )}
        {state !== "idle" && continueSlackButton}
        {error && (
          <StatusText variant="error">{error}</StatusText>
        )}
      </div>

      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[#1a1b26] p-1"
        style={{
          display: state === "idle" ? "none" : "block",
        }}
      />

      {state === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-lg font-medium">
              Interactive Chat
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Start an interactive Claude session to discuss this workspace
            </p>
            <div className="flex items-center justify-center gap-2">
              <StartChatButton label="Start Chat" onStart={openSession} />
              {continueSlackButton}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
