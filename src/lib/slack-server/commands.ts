/**
 * Pure parser for Slack mention text → workspace operation command.
 *
 * Supported syntax (all preceded optionally by `<@USERID>` mention prefixes):
 *   init [--only] <description text...>
 *   help
 *
 * Default `init` triggers the autonomous pipeline starting from init. With
 * `--only`, only the init operation runs (no autonomous chain). The
 * description may be empty; the handler can supply it from thread context.
 */

export type Command = { op: "init"; only: boolean; description: string };

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; reply: string };

export const USAGE = [
  "Usage:",
  "  init <description text...>           # runs autonomous pipeline starting from init",
  "  init --only <description text...>    # runs only the init operation",
  "  help",
  "",
  "Tip: post the mention inside an existing thread to fold the thread's",
  "messages into the description automatically.",
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
    return { ok: false, reply: USAGE };
  }

  // Split off the leading op token.
  const opMatch = stripped.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!opMatch) return { ok: false, reply: USAGE };
  const op = opMatch[1];
  const rest = opMatch[2] ?? "";

  if (op !== "init") {
    return { ok: false, reply: `Unknown command: ${op}\n\n${USAGE}` };
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
    return { ok: false, reply: `Unknown flag: ${stray[1]}\n\n${USAGE}` };
  }

  return { ok: true, command: { op: "init", only, description: working.trim() } };
}
