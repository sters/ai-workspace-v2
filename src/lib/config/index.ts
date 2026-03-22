// Defaults & constants
export {
  CONFIG_DEFAULTS,
  CONFIG_FILE_PATH,
  OPERATION_TYPE_NAMES,
  KNOWN_CONFIG_KEYS,
} from "./defaults";
export type { ConfigKeyDef } from "./defaults";

// Config resolution
export {
  getConfig,
  getOperationConfig,
  mergeConfig,
  loadConfigFile,
  normalizeRawConfig,
  _resetConfig,
  _setConfigFilePath,
} from "./resolver";

// Migration & generation
export {
  ensureConfigFile,
  generateDefaultConfigContent,
  migrateConfigContent,
  migrateConfigFile,
} from "./migration";

// Workspace paths
export {
  AI_WORKSPACE_ROOT,
  WORKSPACE_DIR,
  getAiWorkspaceRoot,
  getWorkspaceDir,
  resolveWorkspaceName,
} from "./workspace";
