import type { Command } from "./commands";

/**
 * Operation summary returned by the operations API. We only consume `id` and
 * `type`; the API returns more fields but we don't need them.
 */
export interface DispatchedOperation {
  id: string;
  type: string;
  workspace?: string;
}

/**
 * POST a parsed Slack command to the local operations API. Returns the
 * created operation (`{ id, type, ... }`).
 *
 * Throws `Error` with status + body text on non-2xx, so the caller can post a
 * useful failure message back to Slack.
 *
 * `interactionLevel: "low"` is always sent so Claude defaults to autonomous
 * behavior (no AskUserQuestion blocking) — Slack is a kick-off-only surface;
 * follow-up happens in the WebUI.
 */
export async function dispatch(
  baseUrl: string,
  cmd: Command,
): Promise<DispatchedOperation> {
  const { path, body } = buildRequest(cmd);
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API call returned ${res.status}: ${text}`);
  }
  return (await res.json()) as DispatchedOperation;
}

interface ApiRequest {
  path: string;
  body: Record<string, unknown>;
}

/**
 * `init --only` → /api/operations/init (single init operation, no chain).
 * `init`        → /api/operations/autonomous with startWith=init (autonomous loop).
 */
export function buildRequest(cmd: Command): ApiRequest {
  if (cmd.only) {
    return {
      path: "/api/operations/init",
      body: { description: cmd.description, interactionLevel: "low" },
    };
  }
  return {
    path: "/api/operations/autonomous",
    body: {
      startWith: "init",
      description: cmd.description,
      interactionLevel: "low",
    },
  };
}
