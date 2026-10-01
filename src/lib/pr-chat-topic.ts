/**
 * What the Pull Requests tab's Chat button opens a discussion chat on: the
 * selected review threads and failing checks, located, linked and quoted.
 *
 * Unlike triage this reads no CI log up front. The chat runs with the host's
 * own `gh`, so it can read a log when the conversation turns out to need one.
 */

import { fenceFor } from "@/lib/chat-selection";
import { renderValidationForPrompt } from "@/lib/templates/prompts/triage-pr-comments";
import type { PrThreadValidation } from "@/types/pull-request";

export interface PrChatThread {
  /** The worktree, relative to the workspace directory. */
  repoPath: string;
  prUrl: string;
  path: string | null;
  line: number | null;
  comments: { author: string; url: string; body: string }[];
  validation?: PrThreadValidation;
}

export interface PrChatCheck {
  repoPath: string;
  prUrl: string;
  name: string;
  url: string | null;
}

function locateThread(thread: PrChatThread): string {
  if (!thread.path) return `${thread.repoPath}, on ${thread.prUrl}`;
  const where = `${thread.repoPath}/${thread.path}`;
  return thread.line == null ? where : `${where}, line ${thread.line}`;
}

function renderThread(thread: PrChatThread): string {
  const comments = thread.comments.map((c) => `${c.author}:\n${c.body}`).join("\n\n");
  const fence = fenceFor(comments);
  const parts = [`Review comment at ${locateThread(thread)}`];
  if (thread.comments[0]) parts.push(thread.comments[0].url);
  parts.push(`${fence}\n${comments}\n${fence}`);
  if (thread.validation) parts.push(renderValidationForPrompt(thread.validation));
  return parts.join("\n");
}

function renderCheck(check: PrChatCheck): string {
  return [
    `Failing check \`${check.name}\` on ${check.prUrl} (worktree ${check.repoPath})`,
    check.url ? `Log: ${check.url}` : "No log link was reported for it.",
  ].join("\n");
}

export function buildPrChatTopic({
  threads,
  checks,
}: {
  threads: PrChatThread[];
  checks: PrChatCheck[];
}): string {
  const items = [...threads.map(renderThread), ...checks.map(renderCheck)];
  return [
    "On this workspace's pull requests (paths are relative to the workspace directory):",
    "",
    items.map((item, i) => `${i + 1}. ${item}`).join("\n\n"),
  ].join("\n");
}
