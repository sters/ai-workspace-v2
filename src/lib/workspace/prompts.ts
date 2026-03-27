/**
 * System prompt file management.
 * Writes static system prompt files to workspace/prompts/ directories
 * and ensures they exist at runtime.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getResolvedWorkspaceRoot } from "@/lib/config";

import {
  getExecutorSystemPrompt,
  getUpdaterSystemPrompt,
  getCodeReviewerSystemPrompt,
  getReviewerSystemPrompt,
  getResearcherSystemPrompt,
  getAutonomousGateSystemPrompt,
  getInitReadmeSystemPrompt,
  getPRCreatorSystemPrompt,
  getSearchSystemPrompt,
  getDiscoverySystemPrompt,
  getPlannerSystemPrompt,
  getResearchPlannerSystemPrompt,
  getCoordinatorSystemPrompt,
  getCollectorSystemPrompt,
  getBestOfNReviewerSystemPrompt,
  getBestOfNFileReviewerSystemPrompt,
  getBestOfNSynthesizerSystemPrompt,
  getRepoConstraintsSystemPrompt,
  getReadmeVerifierSystemPrompt,
  getTodoVerifierSystemPrompt,
  getCreateTodoPlannerSystemPrompt,
  getWorkspaceSuggesterSystemPrompt,
  getChatSystemPrompt,
  getReviewChatSystemPrompt,
  getQuickAskSystemPrompt,
} from "@/lib/templates/prompts";

/** Registry mapping file names to their content generator functions. */
const SYSTEM_PROMPTS: Record<string, () => string> = {
  "executor.md": getExecutorSystemPrompt,
  "updater.md": getUpdaterSystemPrompt,
  "code-reviewer.md": getCodeReviewerSystemPrompt,
  "reviewer.md": getReviewerSystemPrompt,
  "researcher.md": getResearcherSystemPrompt,
  "autonomous-gate.md": getAutonomousGateSystemPrompt,
  "init-readme.md": getInitReadmeSystemPrompt,
  "pr-creator.md": getPRCreatorSystemPrompt,
  "search.md": getSearchSystemPrompt,
  "discovery.md": getDiscoverySystemPrompt,
  "planner.md": getPlannerSystemPrompt,
  "research-planner.md": getResearchPlannerSystemPrompt,
  "coordinator.md": getCoordinatorSystemPrompt,
  "collector.md": getCollectorSystemPrompt,
  "best-of-n-reviewer.md": getBestOfNReviewerSystemPrompt,
  "best-of-n-file-reviewer.md": getBestOfNFileReviewerSystemPrompt,
  "best-of-n-synthesizer.md": getBestOfNSynthesizerSystemPrompt,
  "repo-constraints.md": getRepoConstraintsSystemPrompt,
  "readme-verifier.md": getReadmeVerifierSystemPrompt,
  "todo-verifier.md": getTodoVerifierSystemPrompt,
  "create-todo-planner.md": getCreateTodoPlannerSystemPrompt,
  "workspace-suggester.md": getWorkspaceSuggesterSystemPrompt,
  "chat.md": getChatSystemPrompt,
  "review-chat.md": getReviewChatSystemPrompt,
  "quick-ask.md": getQuickAskSystemPrompt,
};

/** Write all system prompt files to {dir}/prompts/. */
export async function writeSystemPrompts(dir: string): Promise<void> {
  const promptsDir = path.join(dir, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  await Promise.all(
    Object.entries(SYSTEM_PROMPTS).map(([filename, getContent]) =>
      Bun.write(path.join(promptsDir, filename), getContent()),
    ),
  );
}

/**
 * Ensure a system prompt file exists in a workspace and return its absolute path.
 * If the file is missing, regenerate it on the fly.
 */
export function ensureSystemPrompt(wsPath: string, agentName: string): string {
  const filePath = path.join(wsPath, "prompts", `${agentName}.md`);
  if (!existsSync(filePath)) {
    const getContent = SYSTEM_PROMPTS[`${agentName}.md`];
    if (!getContent) {
      throw new Error(`Unknown system prompt agent: ${agentName}`);
    }
    mkdirSync(path.join(wsPath, "prompts"), { recursive: true });
    writeFileSync(filePath, getContent(), "utf-8");
  }
  return filePath;
}

/**
 * Ensure a system prompt file exists at the global workspace root ({workspaceRoot}/prompts/).
 * Used for agents that run outside a specific workspace (init-readme, search, discovery).
 */
export function ensureGlobalSystemPrompt(agentName: string): string {
  const rootPath = getResolvedWorkspaceRoot();
  const filePath = path.join(rootPath, "prompts", `${agentName}.md`);
  if (!existsSync(filePath)) {
    const getContent = SYSTEM_PROMPTS[`${agentName}.md`];
    if (!getContent) {
      throw new Error(`Unknown system prompt agent: ${agentName}`);
    }
    mkdirSync(path.join(rootPath, "prompts"), { recursive: true });
    writeFileSync(filePath, getContent(), "utf-8");
  }
  return filePath;
}
