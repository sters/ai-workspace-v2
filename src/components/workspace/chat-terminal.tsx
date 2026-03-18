"use client";

import { useChatSession } from "@/hooks/use-chat-session";
import { Button } from "../shared/buttons/button";
import { StatusText } from "../shared/feedback/status-text";

export function ChatTerminal({ workspaceId, initialPrompt, reviewTimestamp }: { workspaceId: string; initialPrompt?: string; reviewTimestamp?: string }) {
  const {
    containerRef,
    state,
    exitCode,
    error,
    startSession,
    cancelResume,
    stopSession,
  } = useChatSession(workspaceId, { initialPrompt, reviewTimestamp });

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {state === "idle" && (
          <Button onClick={startSession}>Start Chat</Button>
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
            <Button onClick={startSession}>New Session</Button>
          </>
        )}
        {error && (
          <StatusText variant="error">{error}</StatusText>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[#1a1b26] p-1"
        style={{
          display: state === "idle" ? "none" : "block",
        }}
      />

      {/* Idle state placeholder */}
      {state === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-lg font-medium">
              Interactive Chat
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Start an interactive Claude session to discuss this workspace
            </p>
            <Button onClick={startSession}>Start Chat</Button>
          </div>
        </div>
      )}
    </div>
  );
}
