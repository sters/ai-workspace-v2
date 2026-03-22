/**
 * Fire-and-forget workspace suggestion trigger.
 * Runs Claude in the background to detect out-of-scope items after operations complete.
 */

import { runClaude } from "@/lib/claude";
import { getReadme, getTodos, getReviewSessions, getReviewDetail } from "@/lib/workspace/reader";
import { buildWorkspaceSuggesterPrompt, WORKSPACE_SUGGESTION_SCHEMA } from "@/lib/templates";
import { insertSuggestion } from "@/lib/db";
import { WORKSPACE_DIR } from "@/lib/config";
import path from "node:path";

const SUGGESTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface SuggestionResult {
  suggestions: { title: string; description: string }[];
}

async function gatherOperationOutput(
  workspace: string,
  source: "execute" | "review" | "autonomous-gate",
): Promise<string> {
  if (source === "execute") {
    const todos = await getTodos(workspace);
    const parts: string[] = [];
    for (const todo of todos) {
      const todoPath = path.join(WORKSPACE_DIR, workspace, todo.filename);
      try {
        const content = await Bun.file(todoPath).text();
        parts.push(`### TODO-${todo.repoName}.md\n\n${content}`);
      } catch {
        // skip unreadable files
      }
    }
    return parts.join("\n\n") || "(no TODO files found)";
  }

  // review or autonomous-gate: use latest review summary
  const sessions = await getReviewSessions(workspace);
  if (sessions.length === 0) return "(no review sessions found)";

  const detail = await getReviewDetail(workspace, sessions[0].timestamp);
  if (!detail) return "(could not read review details)";

  return `## Review Summary\n\n${detail.summary}`;
}

async function runSuggester(
  workspace: string,
  operationId: string,
  source: "execute" | "review" | "autonomous-gate",
): Promise<void> {
  const readmeContent = (await getReadme(workspace)) ?? "";
  if (!readmeContent) return; // No README, nothing to compare against

  const operationOutput = await gatherOperationOutput(workspace, source);

  const prompt = buildWorkspaceSuggesterPrompt({
    workspaceName: workspace,
    readmeContent,
    operationOutput,
  });

  // Use a unique pseudo-operation ID (not tracked in pipeline)
  const suggestOpId = `suggest-${operationId}`;

  const proc = runClaude(suggestOpId, prompt, {
    jsonSchema: WORKSPACE_SUGGESTION_SCHEMA,
    skipAskUserQuestion: true,
  });

  // Wait for completion with timeout
  const resultText = await Promise.race([
    new Promise<string | undefined>((resolve) => {
      proc.onEvent((event) => {
        if (event.type === "complete" || event.type === "error") {
          resolve(proc.getResultText());
        }
      });
    }),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SUGGESTION_TIMEOUT_MS)),
  ]);

  if (!resultText) return;

  let parsed: SuggestionResult;
  try {
    parsed = JSON.parse(resultText) as SuggestionResult;
  } catch {
    console.error("[suggest-workspace] Failed to parse suggestion result as JSON");
    return;
  }
  if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) return;

  for (const s of parsed.suggestions) {
    if (!s.title || !s.description) continue;
    insertSuggestion({
      id: crypto.randomUUID(),
      sourceWorkspace: workspace,
      sourceOperationId: operationId,
      title: s.title,
      description: s.description,
    });
  }
}

/**
 * Trigger workspace suggestion detection in the background.
 * Fire-and-forget: errors are logged but never propagated.
 */
export function triggerWorkspaceSuggestion(
  workspace: string,
  operationId: string,
  source: "execute" | "review" | "autonomous-gate",
): void {
  runSuggester(workspace, operationId, source).catch((err) => {
    console.warn("[suggest-workspace] Background suggestion failed:", err);
  });
}
