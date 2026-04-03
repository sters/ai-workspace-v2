// Defaults & constants
export {
  CONFIG_DEFAULTS,
  OPERATION_TYPE_NAMES,
  KNOWN_CONFIG_KEYS,
} from "./defaults";
export type { ConfigKeyDef } from "./defaults";

// Workspace config directory
export {
  getWorkspaceConfigDir,
  getWorkspaceDbPath,
  getWorkspaceConfigFilePath,
} from "./workspace-dir";

// Config resolution
export {
  getConfig,
  getConfigFilePath,
  getOperationConfig,
  getResolvedWorkspaceRoot,
  mergeConfig,
  loadConfigFile,
  normalizeRawConfig,
  setWorkspaceRoot,
  _resetConfig,
  _resetWorkspaceRoot,
  _setConfigFilePath,
} from "./resolver";

// Model resolution
export { resolveModel } from "./model";

// Migration & generation
export {
  ensureConfigFile,
  generateDefaultConfigContent,
  migrateConfigContent,
  migrateConfigFile,
} from "./migration";

// Workspace paths
export {
  getWorkspaceDir,
  resolveWorkspaceName,
  resolveWorkspacePath,
} from "./workspace";
