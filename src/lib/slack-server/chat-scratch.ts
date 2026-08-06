import path from "node:path";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";

/**
 * The Slack conversation runs at the ai-workspace root with no tool-layer
 * restrictions, so the only thing keeping it out of `workspace/` and
 * `repositories/` is its system prompt. A prohibition alone leaves a request
 * that genuinely needs a file ("keep these notes", "save that diff") with
 * nowhere to go, and the model then invents a location — a stray
 * `workspace/<something>.yml` is the observed failure, and it is unreachable
 * from both ends: the WebUI skips every non-directory entry under `workspace/`
 * (`listWorkspaces`), and the prompt forbids the conversation from deleting
 * anything.
 *
 * So the prompt names one sanctioned writable directory instead, per Slack
 * thread. Per-thread rather than shared because two threads asked for `notes.md`
 * would otherwise overwrite each other, and because a thread's leftovers can be
 * removed as a unit.
 *
 * Nothing is created here: the path is only computed and handed to the model,
 * which creates it on demand. Creating it eagerly would leave an empty
 * directory behind for every Slack mention, which is the litter this exists to
 * prevent.
 */

/** Directory under `.ai-workspace/` holding all per-thread scratch space. */
export const SLACK_SCRATCH_DIRNAME = "slack-scratch";

/** Fallback directory name for a thread key with nothing usable in it. */
const FALLBACK_SEGMENT = "thread";

/** Absolute path to the root of the Slack conversation scratch space. */
export function getSlackScratchRoot(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), SLACK_SCRATCH_DIRNAME);
}

/**
 * Reduce a Slack thread key to a single safe path segment. The key is a Slack
 * timestamp in practice, but it is interpolated into a prompt the model then
 * uses as a path, so separators and `..` must not be able to name a directory
 * outside the scratch root.
 */
function toSegment(threadKey: string): string {
  const sanitized = threadKey.replace(/[^A-Za-z0-9._-]/g, "_");
  // A segment of dots only (`.`, `..`, …) still resolves outside the root.
  return /[A-Za-z0-9_-]/.test(sanitized) ? sanitized : FALLBACK_SEGMENT;
}

/**
 * Absolute path to the scratch directory for one Slack thread. The directory is
 * not created — the conversation creates it when it actually writes something.
 */
export function getSlackScratchDir(workspaceRoot: string, threadKey: string): string {
  return path.join(getSlackScratchRoot(workspaceRoot), toSegment(threadKey));
}
