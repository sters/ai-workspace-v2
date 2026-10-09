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

import { pathExists } from "@/lib/fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getResolvedWorkspaceRoot } from "@/lib/config";

import {
  getExecutorSystemPrompt,
  getUpdaterSystemPrompt,
  getReadmeUpdaterSystemPrompt,
  getCodeReviewerSystemPrompt,
  getCrossRepositoryReviewerSystemPrompt,
  getReviewerSystemPrompt,
  getResearchFindingsRepoSystemPrompt,
  getResearchFindingsCrossRepoSystemPrompt,
  getResearchRecommendationsSystemPrompt,
  getResearchIntegrationSystemPrompt,
  getAutonomousGateSystemPrompt,
  getReadmeClarityGateSystemPrompt,
  getCriteriaFeasibilitySystemPrompt,
  getInitReadmeSystemPrompt,
  getPRCreatorSystemPrompt,
  getSearchSystemPrompt,
  getDiscoverySystemPrompt,
  getPlannerSystemPrompt,
  getResearchPlannerSystemPrompt,
  getCoordinatorSystemPrompt,
  getCollectorSystemPrompt,
  getRepoConstraintsSystemPrompt,
  getReadmeVerifierSystemPrompt,
  getTodoVerifierSystemPrompt,
  getFixVerifierSystemPrompt,
  getCreateTodoPlannerSystemPrompt,
  getWorkspaceSuggesterSystemPrompt,
  getChatSystemPrompt,
  getReviewChatSystemPrompt,
  getResearchChatSystemPrompt,
  getTaskChatSystemPrompt,
  getDiscussionChatSystemPrompt,
  getSlackChatSystemPrompt,
  getPrCommentValidatorSystemPrompt,
  getFindingGrounderSystemPrompt,
  getConflictResolverSystemPrompt,
} from "@/lib/templates/prompts";

/** Registry mapping file names to their content generator functions. */
const SYSTEM_PROMPTS: Record<string, () => string> = {
  "executor.md": getExecutorSystemPrompt,
  "updater.md": getUpdaterSystemPrompt,
  "readme-updater.md": getReadmeUpdaterSystemPrompt,
  "code-reviewer.md": getCodeReviewerSystemPrompt,
  "cross-repository-reviewer.md": getCrossRepositoryReviewerSystemPrompt,
  "reviewer.md": getReviewerSystemPrompt,
  "research-findings-repo.md": getResearchFindingsRepoSystemPrompt,
  "research-findings-cross-repo.md": getResearchFindingsCrossRepoSystemPrompt,
  "research-recommendations.md": getResearchRecommendationsSystemPrompt,
  "research-integration.md": getResearchIntegrationSystemPrompt,
  "autonomous-gate.md": getAutonomousGateSystemPrompt,
  "readme-clarity-gate.md": getReadmeClarityGateSystemPrompt,
  "criteria-feasibility.md": getCriteriaFeasibilitySystemPrompt,
  "init-readme.md": getInitReadmeSystemPrompt,
  "pr-creator.md": getPRCreatorSystemPrompt,
  "search.md": getSearchSystemPrompt,
  "discovery.md": getDiscoverySystemPrompt,
  "planner.md": getPlannerSystemPrompt,
  "research-planner.md": getResearchPlannerSystemPrompt,
  "coordinator.md": getCoordinatorSystemPrompt,
  "collector.md": getCollectorSystemPrompt,
  "repo-constraints.md": getRepoConstraintsSystemPrompt,
  "readme-verifier.md": getReadmeVerifierSystemPrompt,
  "todo-verifier.md": getTodoVerifierSystemPrompt,
  "fix-verifier.md": getFixVerifierSystemPrompt,
  "pr-comment-validator.md": getPrCommentValidatorSystemPrompt,
  "finding-grounder.md": getFindingGrounderSystemPrompt,
  "conflict-resolver.md": getConflictResolverSystemPrompt,
  "create-todo-planner.md": getCreateTodoPlannerSystemPrompt,
  "workspace-suggester.md": getWorkspaceSuggesterSystemPrompt,
  "chat.md": getChatSystemPrompt,
  "review-chat.md": getReviewChatSystemPrompt,
  "research-chat.md": getResearchChatSystemPrompt,
  "task-chat.md": getTaskChatSystemPrompt,
  "discussion-chat.md": getDiscussionChatSystemPrompt,
  "slack-chat.md": getSlackChatSystemPrompt,
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

/**
 * Directories verified (or being verified) in this process. The promise, not a
 * flag, so concurrent callers share one check instead of each rewriting the files.
 */
const _verifiedDirs = new Map<string, Promise<void>>();

/**
 * Remove stale .md files in promptsDir that are no longer in SYSTEM_PROMPTS.
 * Leaves the .hash file and any non-.md files alone.
 */
async function removeStalePromptFiles(promptsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(promptsDir);
  } catch {
    return; // Directory doesn't exist yet — nothing to clean up.
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry in SYSTEM_PROMPTS) continue;
    try {
      await unlink(path.join(promptsDir, entry));
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
function ensureUpToDate(dir: string): Promise<void> {
  const promptsDir = path.join(dir, "prompts");
  let verified = _verifiedDirs.get(promptsDir);
  if (!verified) {
    verified = regenerateIfStale(promptsDir);
    _verifiedDirs.set(promptsDir, verified);
    // A failed check is retried by the next caller rather than cached.
    verified.catch(() => _verifiedDirs.delete(promptsDir));
  }
  return verified;
}

async function regenerateIfStale(promptsDir: string): Promise<void> {
  const hashFile = path.join(promptsDir, HASH_FILENAME);
  const currentHash = computePromptsHash();

  let needsUpdate = true;
  if (await pathExists(hashFile)) {
    try {
      const storedHash = (await readFile(hashFile, "utf-8")).trim();
      if (storedHash === currentHash) {
        needsUpdate = false;
      }
    } catch {
      // Corrupted hash file — regenerate
    }
  }

  if (needsUpdate) {
    await mkdir(promptsDir, { recursive: true });
    for (const [filename, getContent] of Object.entries(SYSTEM_PROMPTS)) {
      await writeFile(path.join(promptsDir, filename), getContent(), "utf-8");
    }
    await removeStalePromptFiles(promptsDir);
    await writeFile(hashFile, currentHash, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write all system prompt files to {dir}/prompts/. */
export async function writeSystemPrompts(dir: string): Promise<void> {
  const promptsDir = path.join(dir, "prompts");
  await mkdir(promptsDir, { recursive: true });
  const currentHash = computePromptsHash();
  await Promise.all([
    ...Object.entries(SYSTEM_PROMPTS).map(([filename, getContent]) =>
      Bun.write(path.join(promptsDir, filename), getContent()),
    ),
    Bun.write(path.join(promptsDir, HASH_FILENAME), currentHash),
  ]);
  await removeStalePromptFiles(promptsDir);
  _verifiedDirs.set(promptsDir, Promise.resolve());
}

/**
 * Ensure system prompt files are up-to-date in a workspace and return
 * the absolute path for the requested agent.
 * Auto-regenerates all files when the app's prompt templates have changed.
 */
export async function ensureSystemPrompt(wsPath: string, agentName: string): Promise<string> {
  if (!SYSTEM_PROMPTS[`${agentName}.md`]) {
    throw new Error(`Unknown system prompt agent: ${agentName}`);
  }
  await ensureUpToDate(wsPath);
  return path.join(wsPath, "prompts", `${agentName}.md`);
}

/**
 * Ensure system prompt files are up-to-date at the global workspace root
 * ({workspaceRoot}/prompts/) and return the absolute path for the requested agent.
 * Used for agents that run outside a specific workspace (init-readme, search, discovery).
 */
export async function ensureGlobalSystemPrompt(agentName: string): Promise<string> {
  if (!SYSTEM_PROMPTS[`${agentName}.md`]) {
    throw new Error(`Unknown system prompt agent: ${agentName}`);
  }
  const rootPath = getResolvedWorkspaceRoot();
  await ensureUpToDate(rootPath);
  return path.join(rootPath, "prompts", `${agentName}.md`);
}

/**
 * Create a per-session system prompt file that includes the base agent prompt
 * plus dynamic workspace context. Returns the absolute path to the session file.
 * Used for chat sessions where workspace-specific info must be in the system prompt.
 */
export async function ensureSessionSystemPrompt(
  wsPath: string,
  agentName: string,
  sessionId: string,
  context: { workspaceId: string },
): Promise<string> {
  const baseFile = await ensureSystemPrompt(wsPath, agentName);
  const baseContent = await readFile(baseFile, "utf-8");
  const contextBlock = `\n\nWorkspace: "${context.workspaceId}"\nWorkspace directory: ${wsPath}`;

  const sessionDir = path.join(wsPath, "prompts", "sessions");
  await mkdir(sessionDir, { recursive: true });

  // Clean up stale session prompt files for this agent left over from previous runs.
  // Only removes files matching the naming convention: {agentName}-{numericSessionId}.md
  const stalePattern = new RegExp(`^${agentName}-\\d+\\.md$`);
  try {
    for (const entry of await readdir(sessionDir)) {
      if (stalePattern.test(entry)) {
        try { await unlink(path.join(sessionDir, entry)); } catch { /* best-effort */ }
      }
    }
  } catch { /* directory read failed — ignore */ }

  const sessionFile = path.join(sessionDir, `${agentName}-${sessionId}.md`);
  await writeFile(sessionFile, baseContent + contextBlock, "utf-8");
  return sessionFile;
}

/** Best-effort cleanup of a per-session system prompt file. */
export async function cleanupSessionSystemPrompt(sessionFile: string): Promise<void> {
  try { await unlink(sessionFile); } catch { /* best-effort */ }
}

/** Reset verified dirs cache (for testing). */
export function _resetVerifiedDirs(): void {
  _verifiedDirs.clear();
  _cachedHash = null;
}
