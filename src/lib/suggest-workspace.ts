/**
 * Fire-and-forget workspace suggestion trigger.
 *
 * Reads the just-finished operation's execution transcript (assistant text,
 * thinking, tool-call summaries) and asks Claude to surface incidental
 * out-of-scope observations that wouldn't show up in final TODO/review output.
 */

import { runClaude } from "@/lib/claude";
import { getReadme } from "@/lib/workspace/reader";
import { buildWorkspaceSuggesterPrompt, WORKSPACE_SUGGESTION_SCHEMA } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { insertSuggestion } from "@/lib/db";
import { flushEvents } from "@/lib/db/event-buffer";
import { readOperationLog } from "@/lib/operation-store";
import { parseStreamEvent } from "@/lib/parsers/stream";
import { resolveModel, getWorkspaceDir } from "@/lib/config";
import { STEP_TYPES } from "@/types/pipeline";
import type { OperationType } from "@/types/operation";
import path from "node:path";

const SUGGESTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum characters to include in the transcript digest passed to Claude. */
const MAX_DIGEST_CHARS = 40_000;

/** Maximum length for any single transcript line (longer lines are truncated). */
const MAX_LINE_CHARS = 2_000;

/**
 * Build a digest of an operation's execution transcript from its stored events.
 * Prioritizes assistant text and thinking blocks (where incidental observations
 * live) and tool-call summaries (which show the scope of files Claude touched).
 * Skips tool_results to avoid ballooning the prompt with raw file contents.
 */
export function buildOperationDigest(operationId: string): string {
  const log = readOperationLog(operationId);
  if (!log || log.events.length === 0) return "";

  const lines: string[] = [];
  let remaining = MAX_DIGEST_CHARS;

  for (const event of log.events) {
    if (event.type !== "output") continue;

    const entries = parseStreamEvent(event.data);
    for (const entry of entries) {
      let line: string | null = null;

      if (entry.kind === "text" && entry.content.trim()) {
        line = `[text] ${entry.content.trim()}`;
      } else if (entry.kind === "thinking" && entry.content.trim()) {
        line = `[thinking] ${entry.content.trim()}`;
      } else if (entry.kind === "tool_call" && entry.summary) {
        line = `[tool:${entry.toolName}] ${entry.summary}`;
      }
      // tool_result / system / result / complete intentionally skipped —
      // tool_results are raw file contents (noisy) and the other kinds carry
      // no incidental-observation signal.

      if (!line) continue;

      if (line.length > MAX_LINE_CHARS) {
        line = line.slice(0, MAX_LINE_CHARS) + "…";
      }

      if (line.length + 1 > remaining) {
        lines.push("[…transcript truncated…]");
        return lines.join("\n");
      }
      lines.push(line);
      remaining -= line.length + 1;
    }
  }

  return lines.join("\n");
}

async function runSuggester(
  workspace: string,
  operationId: string,
  parentOperationType: OperationType,
): Promise<void> {
  const readmeContent = (await getReadme(workspace)) ?? "";
  if (!readmeContent) return; // No README, nothing to compare against

  // Ensure any in-memory buffered events for the parent operation are
  // persisted before we read them, so the transcript digest is up to date.
  try {
    flushEvents(operationId);
  } catch {
    // Best-effort: ignore flush errors, we'll just read what's already persisted.
  }

  const operationDigest = buildOperationDigest(operationId);
  if (!operationDigest) return; // Nothing to analyze

  const prompt = buildWorkspaceSuggesterPrompt({
    workspaceName: workspace,
    readmeContent,
    operationDigest,
  });

  // Use a unique pseudo-operation ID (not tracked in pipeline)
  const suggestOpId = `suggest-${operationId}`;

  const wsPath = path.join(getWorkspaceDir(), workspace);
  const model = resolveModel(parentOperationType, STEP_TYPES.SUGGEST_WORKSPACE);
  const proc = runClaude(suggestOpId, prompt, {
    jsonSchema: WORKSPACE_SUGGESTION_SCHEMA,
    skipAskUserQuestion: true,
    appendSystemPromptFile: ensureSystemPrompt(wsPath, "workspace-suggester"),
    model,
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    console.error("[suggest-workspace] Failed to parse suggestion result as JSON");
    return;
  }
  if (typeof parsed !== "object" || parsed === null || !("suggestions" in parsed)) return;
  const { suggestions } = parsed as { suggestions: unknown };
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;

  for (const s of suggestions) {
    if (typeof s !== "object" || s === null) continue;
    const item = s as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.description !== "string") continue;
    insertSuggestion({
      id: crypto.randomUUID(),
      sourceWorkspace: workspace,
      sourceOperationId: operationId,
      targetRepository: typeof item.targetRepository === "string" ? item.targetRepository : "",
      title: item.title,
      description: item.description,
    });
  }
}

/**
 * Trigger workspace suggestion detection in the background.
 * Fire-and-forget: errors are logged but never propagated.
 *
 * @param workspace - Workspace name
 * @param operationId - ID of the parent operation whose transcript will be analyzed
 * @param parentOperationType - Operation type of the parent operation, used for model resolution
 */
export function triggerWorkspaceSuggestion(
  workspace: string,
  operationId: string,
  parentOperationType: OperationType,
): void {
  runSuggester(workspace, operationId, parentOperationType).catch((err) => {
    console.warn("[suggest-workspace] Background suggestion failed:", err);
  });
}
