/**
 * Sync auto-managed Claude Code hooks into `.claude/settings.local.json`
 * and `.claude/hooks/aiw-*.sh`.
 *
 * Managed entries are identified by the `aiw-` prefix on their command
 * path. User-authored hooks (without that prefix) are preserved verbatim.
 */

import { chmod, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { getConfig, getResolvedWorkspaceRoot } from "../../config";
import { getSettingsFilePath, writeSettings } from "../settings";
import {
  BLOCK_DANGEROUS_BASH_SH,
  MANAGED_COMMAND_PREFIX,
  MANAGED_SCRIPT_NAMES,
  SESSION_START_GIT_SH,
} from "./scripts";

const COMMAND_DIR = "$CLAUDE_PROJECT_DIR/.claude/hooks/";

interface HookHandler {
  type: string;
  command?: string;
  [k: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
  [k: string]: unknown;
}

interface SettingsShape {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

const PRE_TOOL_USE_BASH_GROUP = (): HookGroup => ({
  matcher: "Bash",
  hooks: [
    {
      type: "command",
      command: `${COMMAND_DIR}${MANAGED_SCRIPT_NAMES.blockDangerousBash}`,
      timeout: 10,
    },
  ],
});

const SESSION_START_GROUP = (): HookGroup => ({
  matcher: "startup",
  hooks: [
    {
      type: "command",
      command: `${COMMAND_DIR}${MANAGED_SCRIPT_NAMES.sessionStartGit}`,
      timeout: 5,
    },
  ],
});

function isManagedGroup(group: HookGroup): boolean {
  return group.hooks.some(
    (h) => typeof h.command === "string" && h.command.startsWith(MANAGED_COMMAND_PREFIX),
  );
}

function stripManagedFromEvent(groups: HookGroup[] | undefined): HookGroup[] {
  if (!Array.isArray(groups)) return [];
  return groups.filter((g) => !isManagedGroup(g));
}

/**
 * Merge managed hook entries into a settings object. Preserves user hooks.
 * Returns a new object — does not mutate the input.
 */
export function applyManagedHooks(
  settings: SettingsShape,
  flags: { sessionStartGitContext: boolean; blockDangerousBash: boolean },
): SettingsShape {
  const next: SettingsShape = { ...settings };
  const hooks: Record<string, HookGroup[]> = { ...(settings.hooks ?? {}) };

  hooks.PreToolUse = stripManagedFromEvent(hooks.PreToolUse);
  hooks.SessionStart = stripManagedFromEvent(hooks.SessionStart);

  if (flags.blockDangerousBash) {
    hooks.PreToolUse.push(PRE_TOOL_USE_BASH_GROUP());
  }
  if (flags.sessionStartGitContext) {
    hooks.SessionStart.push(SESSION_START_GROUP());
  }

  for (const event of ["PreToolUse", "SessionStart"] as const) {
    if (hooks[event].length === 0) {
      delete hooks[event];
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  } else {
    next.hooks = hooks;
  }

  return next;
}

async function writeHookScript(dir: string, name: string, source: string): Promise<void> {
  const filePath = path.join(dir, name);
  await Bun.write(filePath, source);
  await chmod(filePath, 0o755);
}

/** Remove leftover `aiw-*` files that are not in the current MANAGED_SCRIPT_NAMES set. */
async function pruneStaleManagedScripts(dir: string): Promise<void> {
  const keep = new Set(Object.values(MANAGED_SCRIPT_NAMES));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith("aiw-") && !keep.has(name as (typeof MANAGED_SCRIPT_NAMES)[keyof typeof MANAGED_SCRIPT_NAMES])) {
      await unlink(path.join(dir, name)).catch(() => {});
    }
  }
}

async function readSettingsJson(filePath: string): Promise<SettingsShape> {
  try {
    const raw = await Bun.file(filePath).text();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SettingsShape;
    }
    return {};
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    if (err instanceof SyntaxError) {
      console.warn(`[hooks-sync] settings.local.json has invalid JSON; skipping merge: ${err.message}`);
      throw err; // caller catches to skip overwrite
    }
    throw err;
  }
}

/**
 * Write managed hook scripts and merge their entries into the local settings
 * file. Idempotent — safe to call repeatedly on every startup.
 */
export async function syncManagedHooks(): Promise<void> {
  const cfg = getConfig().hooks;

  const root = getResolvedWorkspaceRoot();
  const hooksDir = path.join(root, ".claude", "hooks");
  await mkdir(hooksDir, { recursive: true });
  await writeHookScript(hooksDir, MANAGED_SCRIPT_NAMES.blockDangerousBash, BLOCK_DANGEROUS_BASH_SH);
  await writeHookScript(hooksDir, MANAGED_SCRIPT_NAMES.sessionStartGit, SESSION_START_GIT_SH);
  await pruneStaleManagedScripts(hooksDir);

  const filePath = getSettingsFilePath("local");
  let current: SettingsShape;
  try {
    current = await readSettingsJson(filePath);
  } catch {
    return; // invalid JSON — leave the file as-is
  }

  const merged = applyManagedHooks(current, cfg);
  await writeSettings("local", JSON.stringify(merged, null, 2));
}
