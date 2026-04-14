import type { AppConfig, OperationTypeSettings } from "@/types/config";
import type { OperationType } from "@/types/operation";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const CONFIG_DEFAULTS: AppConfig = {
  workspaceRoot: null,
  server: {
    port: 3741,
    chatPort: 3742,
    disableAccessLog: false,
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
    bestOfN: 0,
    batchSize: 10,
    typeOverrides: {},
  },
  chat: {
    model: "sonnet",
  },
  quickAsk: {
    model: "sonnet",
    effort: "medium",
    allowedTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  },
  editor: "code {path}",
  terminal: "open -a Terminal {path}",
};

// ---------------------------------------------------------------------------
// Operation type names (for config validation and migration)
// ---------------------------------------------------------------------------

/** All valid OperationType values. Used by migration to recognize sub-sections. */
export const OPERATION_TYPE_NAMES: ReadonlySet<string> = new Set<OperationType>([
  "init",
  "execute",
  "review",
  "create-pr",
  "update-todo",
  "create-todo",
  "delete",
  "workspace-prune",
  "operation-prune",
  "mcp-auth",
  "claude-login",
  "batch",
  "autonomous",
  "search",
]);

/** Setting keys that can be overridden per operation type. */
export const OVERRIDABLE_SETTINGS_KEYS = new Set<keyof OperationTypeSettings>([
  "claudeTimeoutMinutes",
  "functionTimeoutMinutes",
  "defaultInteractionLevel",
  "bestOfN",
  "batchSize",
  "model",
  "steps",
]);

// ---------------------------------------------------------------------------
// Known config key registry
// ---------------------------------------------------------------------------

export interface ConfigKeyDef {
  key: string;
  /** null = top-level key or section header */
  section: string | null;
  /** Default commented-out line to add when missing */
  defaultLine: string;
}

/** Registry of all known config keys, in canonical order. */
export const KNOWN_CONFIG_KEYS: ConfigKeyDef[] = [
  { key: "workspaceRoot", section: null, defaultLine: "# workspaceRoot: /path/to/ai-workspace" },
  { key: "server", section: null, defaultLine: "# server:" },
  { key: "port", section: "server", defaultLine: "#   port: 3741" },
  { key: "chatPort", section: "server", defaultLine: "#   chatPort: 3742" },
  { key: "disableAccessLog", section: "server", defaultLine: "#   disableAccessLog: false   # true silences Next.js dev access logs" },
  { key: "claude", section: null, defaultLine: "# claude:" },
  { key: "path", section: "claude", defaultLine: "#   path: null           # null = auto-detect" },
  { key: "useCli", section: "claude", defaultLine: "#   useCli: true" },
  { key: "operations", section: null, defaultLine: "# operations:" },
  { key: "maxConcurrent", section: "operations", defaultLine: "#   maxConcurrent: 3" },
  { key: "claudeTimeoutMinutes", section: "operations", defaultLine: "#   claudeTimeoutMinutes: 20" },
  { key: "functionTimeoutMinutes", section: "operations", defaultLine: "#   functionTimeoutMinutes: 3" },
  { key: "defaultInteractionLevel", section: "operations", defaultLine: "#   defaultInteractionLevel: mid   # low / mid / high" },
  { key: "bestOfN", section: "operations", defaultLine: "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates" },
  { key: "batchSize", section: "operations", defaultLine: "#   batchSize: 10                  # TODO groups per batch in execute operations" },
  { key: "model", section: "operations", defaultLine: "#   model: null                    # null = CLI default (opus / sonnet / haiku)" },
  { key: "chat", section: null, defaultLine: "# chat:" },
  { key: "model", section: "chat", defaultLine: "#   model: sonnet                  # default model for interactive chat (null = CLI default)" },
  { key: "quickAsk", section: null, defaultLine: "# quickAsk:" },
  { key: "model", section: "quickAsk", defaultLine: "#   model: sonnet                  # default model for quick-ask (null = CLI default)" },
  { key: "effort", section: "quickAsk", defaultLine: "#   effort: medium                 # effort level (low / medium / high / max, null = CLI default)" },
  { key: "allowedTools", section: "quickAsk", defaultLine: "#   allowedTools: [Read, Glob, Grep, WebFetch, WebSearch]  # null = no restriction" },
  { key: "editor", section: null, defaultLine: "# editor: code {path}" },
  { key: "terminal", section: null, defaultLine: "# terminal: open -a Terminal {path}" },
];
