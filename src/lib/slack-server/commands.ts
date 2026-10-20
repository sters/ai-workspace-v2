/**
 * Pure parser for Slack mention text → workspace operation command.
 *
 * Supported syntax (all preceded optionally by `<@USERID>` mention prefixes):
 *   init [--only] <description text...>
 *   ws <description text...>
 *   help
 *
 * Default `init` triggers the autonomous pipeline starting from init. With
 * `--only`, only the init operation runs (no autonomous chain). The
 * description may be empty; the handler can supply it from thread context.
 *
 * `ws` creates a workspace for the request and binds the thread to it, so the
 * thread's conversation runs inside that workspace. Its description is taken
 * verbatim, flags and all: it is prose for the model that picks repositories.
 *
 * Anything that is neither `init` nor `help` is classified as free-form
 * conversation (`kind: "chat"`) so the handler can hand it to a read-only
 * Claude query instead of rejecting it.
 */

export type InitCommand = { op: "init"; only: boolean; description: string };
export type WorkspaceCommand = { op: "ws"; description: string };
export type Command = InitCommand | WorkspaceCommand;

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; kind: "usage"; reply: string }
  | { ok: false; kind: "chat"; message: string };

export const USAGE = [
  "Usage:",
  "  init <description text...>           # runs autonomous pipeline starting from init",
  "  init --only <description text...>    # runs only the init operation",
  "  ws <description text...>             # creates a workspace for this thread to work in",
  "  help",
  "",
  "Anything else you say is answered as a read-only conversation (I can read",
  "and search the workspace and repos, but can't change anything).",
  "",
  "In a thread started with `ws`, the conversation works inside that",
  "workspace and may edit its worktrees, and `init` plans and runs more work",
  "on it instead of creating another one.",
  "",
  "Tip: post the mention inside an existing thread to fold the thread's",
  "messages into the description automatically."
].join("\n");

const MENTION_RE = /^<@[UW][^>|]+(?:\|[^>]+)?>\s*/;

function stripMentions(input: string): string {
  let s = input.trimStart();
  while (MENTION_RE.test(s)) {
    s = s.replace(MENTION_RE, "").trimStart();
  }
  return s;
}

export function parseCommand(rawText: string): ParseResult {
  const stripped = stripMentions(rawText).trim();
  if (stripped === "" || stripped === "help") {
    return { ok: false, kind: "usage", reply: USAGE };
  }

  // Split off the leading op token.
  const opMatch = stripped.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!opMatch) return { ok: false, kind: "usage", reply: USAGE };
  const op = opMatch[1];
  const rest = opMatch[2] ?? "";

  if (op === "ws") {
    return { ok: true, command: { op: "ws", description: rest.trim() } };
  }

  // Everything that isn't a command is free-form conversation.
  if (op !== "init") {
    return { ok: false, kind: "chat", message: stripped };
  }

  return parseInit(rest);
}

function parseInit(rest: string): ParseResult {
  // Pull out --only (anywhere in the rest); reject any other -- flags.
  let only = false;
  let working = rest;

  // Strip the first `--only` occurrence (with surrounding whitespace).
  const onlyMatch = working.match(/(^|\s)--only(\s|$)/);
  if (onlyMatch) {
    only = true;
    const start = onlyMatch.index ?? 0;
    const before = working.slice(0, start);
    const afterIdx = start + onlyMatch[0].length;
    const after = working.slice(afterIdx);
    // Replace the match with a single space to keep word boundaries clean.
    working = (before + (onlyMatch[1] && (after || onlyMatch[2].trim() === "") ? " " : "") + after);
  }

  // Reject any unknown -- flags.
  const stray = working.match(/(?:^|\s)(--\S+)/);
  if (stray) {
    return { ok: false, kind: "usage", reply: `Unknown flag: ${stray[1]}\n\n${USAGE}` };
  }

  return { ok: true, command: { op: "init", only, description: working.trim() } };
}
