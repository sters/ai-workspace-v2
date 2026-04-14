import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppConfig, OperationTypeSettings } from "@/types/config";
import type { OperationType } from "@/types/operation";
import { CONFIG_DEFAULTS, OPERATION_TYPE_NAMES } from "./defaults";
import { getWorkspaceConfigFilePath } from "./workspace-dir";

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

/**
 * Normalize a raw YAML-parsed config object: extract per-operation-type
 * override objects from `operations` into `operations.typeOverrides`.
 *
 * In the YAML file, users write:
 * ```yaml
 * operations:
 *   bestOfN: 3
 *   review:
 *     bestOfN: 0
 * ```
 *
 * The YAML parser produces `{ operations: { bestOfN: 3, review: { bestOfN: 0 } } }`.
 * This function moves the `review` object into `operations.typeOverrides.review`.
 */
export function normalizeRawConfig(raw: Record<string, unknown>): Partial<AppConfig> {
  const result = { ...raw };

  if (result.operations && typeof result.operations === "object" && !Array.isArray(result.operations)) {
    const ops = { ...(result.operations as Record<string, unknown>) };
    const typeOverrides: Record<string, Partial<OperationTypeSettings>> = {};

    for (const key of Object.keys(ops)) {
      if (OPERATION_TYPE_NAMES.has(key) && ops[key] && typeof ops[key] === "object" && !Array.isArray(ops[key])) {
        typeOverrides[key] = ops[key] as Partial<OperationTypeSettings>;
        delete ops[key];
      }
    }

    if (Object.keys(typeOverrides).length > 0) {
      ops.typeOverrides = typeOverrides;
    }

    result.operations = ops;
  }

  return result as Partial<AppConfig>;
}

/**
 * Load and parse a YAML config file. Returns a partial config object or null
 * if the file doesn't exist or fails to parse.
 */
export function loadConfigFile(
  filePath: string,
): Partial<AppConfig> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeRawConfig(parsed as Record<string, unknown>);
  } catch (err) {
    console.warn(`[app-config] Failed to load config from ${filePath}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Env overrides
// ---------------------------------------------------------------------------

function envOverrides(): Partial<AppConfig> {
  const result: Partial<AppConfig> = {};

  if (process.env.AIW_WORKSPACE_ROOT) {
    result.workspaceRoot = process.env.AIW_WORKSPACE_ROOT;
  }

  const port = process.env.AIW_PORT ? parseInt(process.env.AIW_PORT, 10) : undefined;
  const chatPort = process.env.AIW_CHAT_PORT
    ? parseInt(process.env.AIW_CHAT_PORT, 10)
    : undefined;
  const disableAccessLogEnv = process.env.AIW_DISABLE_ACCESS_LOG;
  const disableAccessLog =
    disableAccessLogEnv !== undefined
      ? disableAccessLogEnv === "true" || disableAccessLogEnv === "1"
      : undefined;
  if (
    (port !== undefined && !Number.isNaN(port)) ||
    (chatPort !== undefined && !Number.isNaN(chatPort)) ||
    disableAccessLog !== undefined
  ) {
    const serverOverride: Partial<AppConfig["server"]> = {};
    if (port !== undefined && !Number.isNaN(port)) serverOverride.port = port;
    if (chatPort !== undefined && !Number.isNaN(chatPort)) serverOverride.chatPort = chatPort;
    if (disableAccessLog !== undefined) serverOverride.disableAccessLog = disableAccessLog;
    result.server = serverOverride as AppConfig["server"];
  }

  if (process.env.AIW_CLAUDE_PATH) {
    const claudeOverride: Partial<AppConfig["claude"]> = { ...result.claude, path: process.env.AIW_CLAUDE_PATH };
    result.claude = claudeOverride as AppConfig["claude"];
  }
  if (process.env.AIW_CLAUDE_USE_CLI !== undefined) {
    const claudeOverride: Partial<AppConfig["claude"]> = { ...result.claude, useCli: process.env.AIW_CLAUDE_USE_CLI !== "false" };
    result.claude = claudeOverride as AppConfig["claude"];
  }

  if (process.env.AIW_EDITOR) {
    result.editor = process.env.AIW_EDITOR;
  }

  if (process.env.AIW_TERMINAL) {
    result.terminal = process.env.AIW_TERMINAL;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

/**
 * Merge config layers: defaults <- fileConfig <- envOverrides.
 * Only defined values override; undefined/missing keys fall through.
 */
export function mergeConfig(
  defaults: AppConfig,
  fileConfig: Partial<AppConfig> | null,
  env: Partial<AppConfig>,
): AppConfig {
  const file = fileConfig ?? {};

  function pick<T>(envVal: T | undefined, fileVal: T | undefined, def: T): T {
    if (envVal !== undefined) return envVal;
    if (fileVal !== undefined) return fileVal;
    return def;
  }

  // Merge typeOverrides from file config (env doesn't support per-type overrides)
  const fileTypeOverrides = file.operations?.typeOverrides ?? {};
  const defaultTypeOverrides = defaults.operations.typeOverrides ?? {};
  const mergedTypeOverrides: AppConfig["operations"]["typeOverrides"] = {};

  // Collect all operation type keys from both defaults and file
  const allTypeKeys = new Set([
    ...Object.keys(defaultTypeOverrides),
    ...Object.keys(fileTypeOverrides),
  ]);

  for (const typeKey of allTypeKeys) {
    const defOverride = defaultTypeOverrides[typeKey as OperationType];
    const fileOverride = fileTypeOverrides[typeKey as OperationType];
    if (fileOverride || defOverride) {
      mergedTypeOverrides[typeKey as OperationType] = {
        ...defOverride,
        ...fileOverride,
      };
    }
  }

  return {
    workspaceRoot: pick(env.workspaceRoot, file.workspaceRoot, defaults.workspaceRoot),
    server: {
      port: pick(env.server?.port, file.server?.port, defaults.server.port),
      chatPort: pick(env.server?.chatPort, file.server?.chatPort, defaults.server.chatPort),
      disableAccessLog: pick(
        env.server?.disableAccessLog,
        file.server?.disableAccessLog,
        defaults.server.disableAccessLog,
      ),
    },
    claude: {
      path: pick(env.claude?.path, file.claude?.path, defaults.claude.path),
      useCli: pick(env.claude?.useCli, file.claude?.useCli, defaults.claude.useCli),
    },
    operations: {
      maxConcurrent: pick(
        env.operations?.maxConcurrent,
        file.operations?.maxConcurrent,
        defaults.operations.maxConcurrent,
      ),
      claudeTimeoutMinutes: pick(
        env.operations?.claudeTimeoutMinutes,
        file.operations?.claudeTimeoutMinutes,
        defaults.operations.claudeTimeoutMinutes,
      ),
      functionTimeoutMinutes: pick(
        env.operations?.functionTimeoutMinutes,
        file.operations?.functionTimeoutMinutes,
        defaults.operations.functionTimeoutMinutes,
      ),
      defaultInteractionLevel: pick(
        env.operations?.defaultInteractionLevel,
        file.operations?.defaultInteractionLevel,
        defaults.operations.defaultInteractionLevel,
      ),
      bestOfN: pick(
        env.operations?.bestOfN,
        file.operations?.bestOfN,
        defaults.operations.bestOfN,
      ),
      batchSize: pick(
        env.operations?.batchSize,
        file.operations?.batchSize,
        defaults.operations.batchSize,
      ),
      model: pick(
        env.operations?.model,
        file.operations?.model,
        defaults.operations.model,
      ),
      typeOverrides: mergedTypeOverrides,
    },
    chat: {
      model: pick(env.chat?.model, file.chat?.model, defaults.chat.model),
    },
    quickAsk: {
      model: pick(env.quickAsk?.model, file.quickAsk?.model, defaults.quickAsk.model),
      allowedTools: (env.quickAsk?.allowedTools ?? file.quickAsk?.allowedTools ?? defaults.quickAsk.allowedTools),
    },
    editor: pick(env.editor, file.editor, defaults.editor),
    terminal: pick(env.terminal, file.terminal, defaults.terminal),
  };
}

// ---------------------------------------------------------------------------
// Per-operation-type config resolution
// ---------------------------------------------------------------------------

/**
 * Get resolved settings for a specific operation type.
 * Per-type overrides take precedence over the global defaults.
 */
export function getOperationConfig(type: OperationType): OperationTypeSettings {
  const cfg = getConfig();
  const overrides = cfg.operations.typeOverrides?.[type];
  return {
    claudeTimeoutMinutes: overrides?.claudeTimeoutMinutes ?? cfg.operations.claudeTimeoutMinutes,
    functionTimeoutMinutes: overrides?.functionTimeoutMinutes ?? cfg.operations.functionTimeoutMinutes,
    defaultInteractionLevel: overrides?.defaultInteractionLevel ?? cfg.operations.defaultInteractionLevel,
    bestOfN: overrides?.bestOfN ?? cfg.operations.bestOfN,
    batchSize: overrides?.batchSize ?? cfg.operations.batchSize,
    model: overrides?.model ?? cfg.operations.model,
    steps: overrides?.steps,
  };
}

// ---------------------------------------------------------------------------
// Cached singleton (stored on globalThis to survive Next.js module isolation)
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as {
  __aiwAppConfig?: AppConfig | null;
  __aiwConfigFilePath?: string;
  __aiwWorkspaceRoot?: string;
};

/**
 * Set the workspace root early in startup. Must be called before getConfig().
 * This determines where config.yml and db.sqlite are stored.
 */
export function setWorkspaceRoot(root: string): void {
  globalStore.__aiwWorkspaceRoot = path.resolve(root);
}

/**
 * Get the workspace root, if set. Falls back to env var or cwd.
 */
export function getResolvedWorkspaceRoot(): string {
  if (globalStore.__aiwWorkspaceRoot) return globalStore.__aiwWorkspaceRoot;
  if (process.env.AIW_WORKSPACE_ROOT) return path.resolve(process.env.AIW_WORKSPACE_ROOT);
  return process.cwd();
}

/**
 * Get the active config file path based on current workspace root.
 * If `_setConfigFilePath()` was used (for testing), that takes precedence.
 */
export function getConfigFilePath(): string {
  if (globalStore.__aiwConfigFilePath) return globalStore.__aiwConfigFilePath;
  return getWorkspaceConfigFilePath(getResolvedWorkspaceRoot());
}

/**
 * Get the resolved app config (cached). Priority: env > config.yml > defaults.
 */
export function getConfig(): AppConfig {
  if (globalStore.__aiwAppConfig) return globalStore.__aiwAppConfig;
  const filePath = getConfigFilePath();
  const fileConfig = loadConfigFile(filePath);
  globalStore.__aiwAppConfig = mergeConfig(CONFIG_DEFAULTS, fileConfig, envOverrides());
  return globalStore.__aiwAppConfig;
}

/** Reset the cached config so the next getConfig() call reloads from disk. */
export function _resetConfig(): void {
  globalStore.__aiwAppConfig = null;
}

/** Reset the workspace root (for testing). */
export function _resetWorkspaceRoot(): void {
  delete globalStore.__aiwWorkspaceRoot;
}

/** Override the config file path (for testing). Pass null to restore default. */
export function _setConfigFilePath(p: string | null): void {
  if (p === null) {
    delete globalStore.__aiwConfigFilePath;
  } else {
    globalStore.__aiwConfigFilePath = p;
  }
}
