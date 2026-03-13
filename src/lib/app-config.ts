import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import type { AppConfig } from "@/types/config";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const CONFIG_DEFAULTS: AppConfig = {
  workspaceRoot: null,
  server: {
    port: 3741,
    chatPort: 3742,
  },
  claude: {
    path: null,
    useCli: true,
  },
  operations: {
    maxConcurrent: 3,
    claudeTimeoutMinutes: 20,
    functionTimeoutMinutes: 3,
    defaultInteractionLevel: "mid",
  },
  editor: "code {path}",
  terminal: "open -a Terminal {path}",
};

export const CONFIG_FILE_PATH = path.join(
  os.homedir(),
  ".config",
  "ai-workspace",
  "config.yml",
);

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

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
    return parsed as Partial<AppConfig>;
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

  if (process.env.AI_WORKSPACE_ROOT) {
    result.workspaceRoot = process.env.AI_WORKSPACE_ROOT;
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const chatPort = process.env.CHAT_WS_PORT
    ? parseInt(process.env.CHAT_WS_PORT, 10)
    : undefined;
  if (port !== undefined || chatPort !== undefined) {
    result.server = {
      ...(port !== undefined && { port }),
      ...(chatPort !== undefined && { chatPort }),
    } as AppConfig["server"];
  }

  if (process.env.CLAUDE_PATH) {
    result.claude = {
      ...result.claude,
      path: process.env.CLAUDE_PATH,
    } as AppConfig["claude"];
  }
  if (process.env.CLAUDE_USE_CLI !== undefined) {
    result.claude = {
      ...result.claude,
      useCli: process.env.CLAUDE_USE_CLI !== "false",
    } as AppConfig["claude"];
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

  return {
    workspaceRoot: pick(env.workspaceRoot, file.workspaceRoot, defaults.workspaceRoot),
    server: {
      port: pick(env.server?.port, file.server?.port, defaults.server.port),
      chatPort: pick(env.server?.chatPort, file.server?.chatPort, defaults.server.chatPort),
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
    },
    editor: pick(env.editor, file.editor, defaults.editor),
    terminal: pick(env.terminal, file.terminal, defaults.terminal),
  };
}

// ---------------------------------------------------------------------------
// Cached singleton
// ---------------------------------------------------------------------------

let _config: AppConfig | null = null;

/**
 * Get the resolved app config (cached). Priority: env > config.yml > defaults.
 */
export function getConfig(): AppConfig {
  if (_config) return _config;
  const fileConfig = loadConfigFile(CONFIG_FILE_PATH);
  _config = mergeConfig(CONFIG_DEFAULTS, fileConfig, envOverrides());
  return _config;
}

/** Reset the cached config (for testing). */
export function _resetConfig(): void {
  _config = null;
}
