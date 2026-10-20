/**
 * The `ws` mention: create a workspace for the request through the WebUI's
 * quick create, with the repositories, task type and name decided by a
 * one-shot model call instead of a form.
 *
 * Creation goes through the HTTP API, like `init`, so the Next.js process stays
 * the one that sets up worktrees. The API's own follow-up (a task chat in the
 * browser) is turned off: the Slack thread runs its own session on the
 * workspace.
 */

import { runClaude } from "@/lib/claude";
import { getConfig, getResolvedWorkspaceRoot } from "@/lib/config";
import {
  buildSlackWorkspacePlanPrompt,
  parseSlackWorkspacePlan,
  SLACK_WORKSPACE_PLAN_SCHEMA,
  type SlackWorkspacePlan,
} from "@/lib/templates/prompts";
import type { SelectableRepository } from "@/types/workspace";

const PLAN_TIMEOUT_MS = 3 * 60 * 1000;

export type SlackWorkspaceCreation =
  | {
      ok: true;
      workspace: string;
      workspacePath: string;
      /** Names of the repositories that got a worktree. */
      repositories: string[];
      problems: { repository: string; error: string }[];
    }
  | { ok: false; reason: "no-repositories" }
  | { ok: false; reason: "plan-failed" }
  | { ok: false; reason: "create-failed"; error: string };

export interface SlackWorkspaceCreateDeps {
  fetch?: typeof fetch;
  plan?: (description: string, repositories: SelectableRepository[]) => Promise<SlackWorkspacePlan | null>;
}

/** Ask the model which repositories, task type and name the request needs. `null` when it gave no usable answer. */
export function planSlackWorkspace(
  description: string,
  repositories: SelectableRepository[],
): Promise<SlackWorkspacePlan | null> {
  const config = getConfig();
  const proc = runClaude("slack-workspace-plan", buildSlackWorkspacePlanPrompt(description, repositories), {
    cwd: getResolvedWorkspaceRoot(),
    jsonSchema: SLACK_WORKSPACE_PLAN_SCHEMA,
    skipAskUserQuestion: true,
    model: config.slack.chatModel ?? undefined,
    effort: "low",
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (plan: SlackWorkspacePlan | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(plan);
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(null);
    }, PLAN_TIMEOUT_MS);
    proc.onEvent((event) => {
      if (event.type === "error") finish(null);
      else if (event.type === "complete") finish(parseSlackWorkspacePlan(proc.getResultText()));
    });
  });
}

/**
 * The repositories already cloned, for the planner to choose from. An empty
 * list on failure: the request may still name a repository outright, which
 * quick create clones.
 */
async function listRepositories(apiBaseUrl: string, fetchFn: typeof fetch): Promise<SelectableRepository[]> {
  try {
    const res = await fetchFn(`${apiBaseUrl}/api/repositories`);
    if (!res.ok) return [];
    const body = (await res.json()) as { repositories?: SelectableRepository[] };
    return body.repositories ?? [];
  } catch {
    return [];
  }
}

export async function createSlackWorkspace(
  apiBaseUrl: string,
  description: string,
  deps: SlackWorkspaceCreateDeps = {},
): Promise<SlackWorkspaceCreation> {
  const fetchFn = deps.fetch ?? fetch;
  const plan = await (deps.plan ?? planSlackWorkspace)(description, await listRepositories(apiBaseUrl, fetchFn));
  if (!plan) return { ok: false, reason: "plan-failed" };
  if (plan.repositories.length === 0) return { ok: false, reason: "no-repositories" };

  let res: Response;
  try {
    res = await fetchFn(`${apiBaseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: plan.name,
        taskType: plan.taskType,
        repositories: plan.repositories,
        note: description,
        followUp: false,
      }),
    });
  } catch (err) {
    return { ok: false, reason: "create-failed", error: err instanceof Error ? err.message : String(err) };
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    workspace?: string;
    workspacePath?: string;
    repositories?: { repoName: string }[];
    problems?: { repository: string; error: string }[];
  };
  if (!res.ok || !body.workspace || !body.workspacePath) {
    return { ok: false, reason: "create-failed", error: body.error ?? `API call returned ${res.status}` };
  }
  return {
    ok: true,
    workspace: body.workspace,
    workspacePath: body.workspacePath,
    repositories: (body.repositories ?? []).map((r) => r.repoName),
    problems: body.problems ?? [],
  };
}
