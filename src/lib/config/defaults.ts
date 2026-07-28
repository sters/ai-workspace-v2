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
  },
  operations: {
    maxConcurrent: 3,
    // Sized to the review fan-out: `2..3 children per repo + 1 cross-repo`, so
    // 8 covers a two-repo workspace outright and leaves a three-repo one only
    // slightly queued. Raising it costs concurrency, not tokens — the same
    // children run either way, just compressed in time.
    maxGroupConcurrency: 8,
    claudeTimeoutMinutes: 20,
    functionTimeoutMinutes: 3,
    defaultInteractionLevel: "mid",
    bestOfN: 0,
    batchSize: 10,
    typeOverrides: {},
  },
  chat: {
    model: null,
  },
  openers: [
    { name: "Editor (VSCode)", command: "code {path}" },
    { name: "Terminal", command: "open -a Terminal {path}" },
  ],
  suggest: {
    enabled: true,
  },
  hooks: {
    sessionStartGitContext: true,
    blockDangerousBash: true,
  },
  slack: {
    enabled: false,
    botToken: "",
    appToken: "",
    allowedUserIds: [],
    chatModel: "sonnet",
    chatEffort: "medium",
    chatHeartbeatMs: 1 * 60 * 1000,
    chatMaxTurnMs: 18 * 60 * 1000,
    chatProgressModel: "haiku",
    memoryEnabled: true,
  },
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
  "update-readme",
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
  "effort",
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
  { key: "operations", section: null, defaultLine: "# operations:" },
  { key: "maxConcurrent", section: "operations", defaultLine: "#   maxConcurrent: 3" },
  { key: "maxGroupConcurrency", section: "operations", defaultLine: "#   maxGroupConcurrency: 8         # Claude children started at once within one parallel group (per group, so it multiplies with maxConcurrent)" },
  { key: "claudeTimeoutMinutes", section: "operations", defaultLine: "#   claudeTimeoutMinutes: 20" },
  { key: "functionTimeoutMinutes", section: "operations", defaultLine: "#   functionTimeoutMinutes: 3" },
  { key: "defaultInteractionLevel", section: "operations", defaultLine: "#   defaultInteractionLevel: mid   # low / mid / high" },
  { key: "bestOfN", section: "operations", defaultLine: "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates" },
  { key: "batchSize", section: "operations", defaultLine: "#   batchSize: 10                  # TODO groups per batch in execute operations" },
  { key: "model", section: "operations", defaultLine: "#   model: null                    # null = CLI default (opus / sonnet / haiku)" },
  { key: "effort", section: "operations", defaultLine: "#   effort: null                   # null = per-step default (low / medium / high / xhigh / max)" },
  { key: "chat", section: null, defaultLine: "# chat:" },
  { key: "model", section: "chat", defaultLine: "#   model: null                    # default model for interactive chat (null = CLI default)" },
  {
    key: "openers",
    section: null,
    defaultLine: [
      "# openers:",
      "#   - name: Editor (VSCode)",
      "#     command: code {path}",
      "#   - name: Terminal",
      "#     command: open -a Terminal {path}",
    ].join("\n"),
  },
  { key: "suggest", section: null, defaultLine: "# suggest:" },
  { key: "enabled", section: "suggest", defaultLine: "#   enabled: true                  # false disables the post-operation workspace-suggestion feature" },
  { key: "hooks", section: null, defaultLine: "# hooks:" },
  { key: "sessionStartGitContext", section: "hooks", defaultLine: "#   sessionStartGitContext: true   # inject git branch+status into SessionStart" },
  { key: "blockDangerousBash", section: "hooks", defaultLine: "#   blockDangerousBash: true        # PreToolUse(Bash) blocks rm -rf /, git push --force, git reset --hard" },
  { key: "slack", section: null, defaultLine: "# slack:" },
  { key: "enabled", section: "slack", defaultLine: "#   enabled: false                  # opt-in; spawns a Socket Mode bot process" },
  { key: "botToken", section: "slack", defaultLine: "#   botToken: \"{ENV:AIW_SLACK_BOT_TOKEN}\"   # xoxb-... ; supports {ENV:VAR} substitution" },
  { key: "appToken", section: "slack", defaultLine: "#   appToken: \"{ENV:AIW_SLACK_APP_TOKEN}\"   # xapp-... ; Socket Mode app-level token" },
  { key: "allowedUserIds", section: "slack", defaultLine: "#   allowedUserIds: []              # Slack user IDs allowed to invoke commands; empty = none" },
  { key: "chatModel", section: "slack", defaultLine: "#   chatModel: sonnet               # model for read-only conversation (non-init mentions); null = CLI default" },
  { key: "chatEffort", section: "slack", defaultLine: "#   chatEffort: medium              # conversation effort level (low / medium / high / max, null = CLI default)" },
  { key: "chatHeartbeatMs", section: "slack", defaultLine: "#   chatHeartbeatMs: 60000          # post interim progress to the thread every N ms while a turn runs" },
  { key: "chatMaxTurnMs", section: "slack", defaultLine: "#   chatMaxTurnMs: 1080000          # hard cap per turn (ms) before giving up (18 min)" },
  { key: "chatProgressModel", section: "slack", defaultLine: "#   chatProgressModel: haiku        # model that summarizes interim progress to one line; null = disable" },
  { key: "memoryEnabled", section: "slack", defaultLine: "#   memoryEnabled: true             # per-user memory the conversation can read/write via sqlite3" },
];

/**
 * Legacy top-level keys that the migrator should recognize (and therefore not
 * comment out as "unknown") but should never add to a new or partial config
 * file. They're auto-converted to `openers` at runtime by `normalizeRawConfig`.
 */
export const LEGACY_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "editor",
  "terminal",
]);
