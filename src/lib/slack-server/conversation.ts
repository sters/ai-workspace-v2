/**
 * Free-form, read-only Slack conversation backed by the Claude CLI.
 *
 * Each Slack thread maps to one Claude CLI session so follow-up messages in
 * the same thread continue the conversation (via `--resume`). Sessions are
 * held in memory only — if the slack-server process restarts, threads start
 * fresh, which is acceptable for a chat surface.
 *
 * The session is intentionally READ-ONLY: only Read/Glob/Grep/WebFetch/
 * WebSearch are allowed. Mutations happen through the WebUI or the `init`
 * command, never here.
 */

import { runClaude } from "@/lib/claude";
import { getConfig, getResolvedWorkspaceRoot } from "@/lib/config";
import { buildSlackChatPrompt } from "@/lib/templates/prompts";

/** Tools the Slack conversation is permitted to use. Read-only by design. */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"];

/** How long a thread's session is kept before it is considered stale. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Cap on tracked threads to bound memory; oldest is evicted past this. */
const MAX_SESSIONS = 200;
/** Kill a conversation turn that runs longer than this. */
const TURN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface SessionEntry {
  sessionId: string;
  lastActive: number;
}

/**
 * In-memory map of Slack thread key → Claude CLI session id, with TTL and a
 * size cap. Pure aside from the injected `now`, so eviction is unit-testable.
 */
export class ConversationSessions {
  private readonly map = new Map<string, SessionEntry>();

  constructor(
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly maxEntries: number = MAX_SESSIONS,
  ) {}

  /** Return the live session id for a thread, or undefined if absent/expired. */
  get(key: string, now: number): string | undefined {
    this.prune(now);
    return this.map.get(key)?.sessionId;
  }

  /** Record (or refresh) the session id for a thread. */
  set(key: string, sessionId: string, now: number): void {
    this.prune(now);
    this.map.set(key, { sessionId, lastActive: now });
    if (this.map.size > this.maxEntries) this.evictOldest();
  }

  /** Number of tracked threads (mainly for tests). */
  get size(): number {
    return this.map.size;
  }

  /** Drop all tracked sessions. */
  clear(): void {
    this.map.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.map) {
      if (now - entry.lastActive > this.ttlMs) this.map.delete(key);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [key, entry] of this.map) {
      if (entry.lastActive < oldest) {
        oldest = entry.lastActive;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.map.delete(oldestKey);
  }
}

const sessions = new ConversationSessions();

/**
 * Answer one conversation turn for the given Slack thread.
 *
 * `threadKey` should be stable per Slack thread (e.g. `thread_ts ?? ts`). The
 * first turn sends full instructions; resume turns send only the message and
 * rely on the CLI session for context.
 *
 * Returns the assistant's reply text. Never throws — on failure it returns a
 * short human-readable error string suitable for posting to Slack.
 */
export async function converse(threadKey: string, message: string): Promise<string> {
  const now = Date.now();
  const resumeSessionId = sessions.get(threadKey, now);
  const workspaceRoot = getResolvedWorkspaceRoot();
  const prompt = buildSlackChatPrompt(workspaceRoot, message, resumeSessionId === undefined);

  const { chatModel, chatEffort } = getConfig().slack;

  const proc = runClaude("slack-chat", prompt, {
    cwd: workspaceRoot,
    allowedTools: READ_ONLY_TOOLS,
    resumeSessionId,
    skipAskUserQuestion: true,
    model: chatModel ?? undefined,
    effort: chatEffort ?? undefined,
  });

  return await new Promise<string>((resolve) => {
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };

    const timer = setTimeout(() => {
      proc.kill();
      finish("Sorry, that took too long and I gave up. Please try a narrower question.");
    }, TURN_TIMEOUT_MS);

    proc.onEvent((event) => {
      if (event.type !== "complete") return;
      const sessionId = proc.getSessionId();
      if (sessionId) sessions.set(threadKey, sessionId, Date.now());
      const text = proc.getResultText()?.trim();
      finish(text && text.length > 0 ? text : "(no response)");
    });
  });
}

/** Reset the in-memory session map. For tests only. */
export function _resetConversationSessions(): void {
  sessions.clear();
}
