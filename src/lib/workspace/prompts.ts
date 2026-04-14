/**
 * System prompt file management.
 * Writes static system prompt files to workspace/prompts/ directories
 * and ensures they exist and stay up-to-date at runtime.
 *
 * Auto-update mechanism: a content hash of all prompt templates is written
 * to prompts/.hash. When ensureSystemPrompt is called, the hash is compared
 * with the current templates. If they differ (e.g., after an app update),
 * all prompt files in that directory are regenerated. Each directory is
 * checked at most once per process to avoid redundant I/O.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getResolvedWorkspaceRoot } from "@/lib/config";

import {
  getExecutorSystemPrompt,
  getUpdaterSystemPrompt,
  getCodeReviewerSystemPrompt,
  getReviewerSystemPrompt,
  getResearchFindingsRepoSystemPrompt,
  getResearchFindingsCrossRepoSystemPrompt,
  getResearchRecommendationsSystemPrompt,
  getResearchIntegrationSystemPrompt,
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
  "research-findings-repo.md": getResearchFindingsRepoSystemPrompt,
  "research-findings-cross-repo.md": getResearchFindingsCrossRepoSystemPrompt,
  "research-recommendations.md": getResearchRecommendationsSystemPrompt,
  "research-integration.md": getResearchIntegrationSystemPrompt,
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

// ---------------------------------------------------------------------------
// Content hash for auto-update detection
// ---------------------------------------------------------------------------

let _cachedHash: string | null = null;

/** Compute a SHA-256 hash of all system prompt contents combined. */
function computePromptsHash(): string {
  if (_cachedHash) return _cachedHash;
  const hasher = createHash("sha256");
  for (const [filename, getContent] of Object.entries(SYSTEM_PROMPTS)) {
    hasher.update(filename);
    hasher.update(getContent());
  }
  _cachedHash = hasher.digest("hex");
  return _cachedHash;
}

const HASH_FILENAME = ".hash";

/** Directories already verified in this process. */
const _verifiedDirs = new Set<string>();

/**
 * Remove stale .md files in promptsDir that are no longer in SYSTEM_PROMPTS.
 * Leaves the .hash file and any non-.md files alone.
 */
function removeStalePromptFiles(promptsDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(promptsDir);
  } catch {
    return; // Directory doesn't exist yet — nothing to clean up.
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry in SYSTEM_PROMPTS) continue;
    try {
      unlinkSync(path.join(promptsDir, entry));
    } catch {
      // Best-effort cleanup; ignore failures.
    }
  }
}

/**
 * Check whether the prompts in a directory are up-to-date.
 * If not (or if the directory/hash file is missing), regenerate all files
 * and remove any stale .md files no longer in SYSTEM_PROMPTS.
 * Each directory is checked at most once per process.
 */
function ensureUpToDate(dir: string): void {
  const promptsDir = path.join(dir, "prompts");
  if (_verifiedDirs.has(promptsDir)) return;

  const hashFile = path.join(promptsDir, HASH_FILENAME);
  const currentHash = computePromptsHash();

  let needsUpdate = true;
  if (existsSync(hashFile)) {
    try {
      const storedHash = readFileSync(hashFile, "utf-8").trim();
      if (storedHash === currentHash) {
        needsUpdate = false;
      }
    } catch {
      // Corrupted hash file — regenerate
    }
  }

  if (needsUpdate) {
    mkdirSync(promptsDir, { recursive: true });
    for (const [filename, getContent] of Object.entries(SYSTEM_PROMPTS)) {
      writeFileSync(path.join(promptsDir, filename), getContent(), "utf-8");
    }
    removeStalePromptFiles(promptsDir);
    writeFileSync(hashFile, currentHash, "utf-8");
  }

  _verifiedDirs.add(promptsDir);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write all system prompt files to {dir}/prompts/. */
export async function writeSystemPrompts(dir: string): Promise<void> {
  const promptsDir = path.join(dir, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  const currentHash = computePromptsHash();
  await Promise.all([
    ...Object.entries(SYSTEM_PROMPTS).map(([filename, getContent]) =>
      Bun.write(path.join(promptsDir, filename), getContent()),
    ),
    Bun.write(path.join(promptsDir, HASH_FILENAME), currentHash),
  ]);
  removeStalePromptFiles(promptsDir);
  _verifiedDirs.add(promptsDir);
}

/**
 * Ensure system prompt files are up-to-date in a workspace and return
 * the absolute path for the requested agent.
 * Auto-regenerates all files when the app's prompt templates have changed.
 */
export function ensureSystemPrompt(wsPath: string, agentName: string): string {
  if (!SYSTEM_PROMPTS[`${agentName}.md`]) {
    throw new Error(`Unknown system prompt agent: ${agentName}`);
  }
  ensureUpToDate(wsPath);
  return path.join(wsPath, "prompts", `${agentName}.md`);
}

/**
 * Ensure system prompt files are up-to-date at the global workspace root
 * ({workspaceRoot}/prompts/) and return the absolute path for the requested agent.
 * Used for agents that run outside a specific workspace (init-readme, search, discovery).
 */
export function ensureGlobalSystemPrompt(agentName: string): string {
  if (!SYSTEM_PROMPTS[`${agentName}.md`]) {
    throw new Error(`Unknown system prompt agent: ${agentName}`);
  }
  const rootPath = getResolvedWorkspaceRoot();
  ensureUpToDate(rootPath);
  return path.join(rootPath, "prompts", `${agentName}.md`);
}

/**
 * Create a per-session system prompt file that includes the base agent prompt
 * plus dynamic workspace context. Returns the absolute path to the session file.
 * Used for chat sessions where workspace-specific info must be in the system prompt.
 */
export function ensureSessionSystemPrompt(
  wsPath: string,
  agentName: string,
  sessionId: string,
  context: { workspaceId: string },
): string {
  const baseFile = ensureSystemPrompt(wsPath, agentName);
  const baseContent = readFileSync(baseFile, "utf-8");
  const contextBlock = `\n\nWorkspace: "${context.workspaceId}"\nWorkspace directory: ${wsPath}`;

  const sessionDir = path.join(wsPath, "prompts", "sessions");
  mkdirSync(sessionDir, { recursive: true });

  // Clean up stale session prompt files for this agent left over from previous runs.
  // Only removes files matching the naming convention: {agentName}-{numericSessionId}.md
  const stalePattern = new RegExp(`^${agentName}-\\d+\\.md$`);
  try {
    for (const entry of readdirSync(sessionDir)) {
      if (stalePattern.test(entry)) {
        try { unlinkSync(path.join(sessionDir, entry)); } catch { /* best-effort */ }
      }
    }
  } catch { /* directory read failed — ignore */ }

  const sessionFile = path.join(sessionDir, `${agentName}-${sessionId}.md`);
  writeFileSync(sessionFile, baseContent + contextBlock, "utf-8");
  return sessionFile;
}

/** Best-effort cleanup of a per-session system prompt file. */
export function cleanupSessionSystemPrompt(sessionFile: string): void {
  try { unlinkSync(sessionFile); } catch { /* best-effort */ }
}

/** Reset verified dirs cache (for testing). */
export function _resetVerifiedDirs(): void {
  _verifiedDirs.clear();
  _cachedHash = null;
}
