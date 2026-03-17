import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
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
    typeOverrides: {},
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
  "search",
]);

/** Setting keys that can be overridden per operation type. */
const OVERRIDABLE_SETTINGS_KEYS = new Set<keyof OperationTypeSettings>([
  "claudeTimeoutMinutes",
  "functionTimeoutMinutes",
  "defaultInteractionLevel",
  "bestOfN",
]);

// ---------------------------------------------------------------------------
// Config file generation
// ---------------------------------------------------------------------------

/** Generate default config file content with comments. */
export function generateDefaultConfigContent(): string {
  const lines = [
    "# ai-workspace configuration",
    "# All fields are optional.",
    "",
    "# workspaceRoot: /path/to/ai-workspace",
    "",
    "# server:",
    "#   port: 3741",
    "#   chatPort: 3742",
    "",
    "# claude:",
    "#   path: null           # null = auto-detect",
    "#   useCli: true",
    "",
    "# operations:",
    "#   maxConcurrent: 3",
    "#   claudeTimeoutMinutes: 20",
    "#   functionTimeoutMinutes: 3",
    "#   defaultInteractionLevel: mid   # low / mid / high",
    "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates",
    "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
    "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
    "#   #   claudeTimeoutMinutes: 20",
    "#   #   functionTimeoutMinutes: 3",
    "#   #   defaultInteractionLevel: mid",
    "#   #   bestOfN: 0",
    "",
    "# editor: code {path}",
    "# terminal: open -a Terminal {path}",
    "",
  ];
  return lines.join("\n");
}

/**
 * Create the config file with commented-out defaults if it doesn't exist.
 * Returns true if the file was created, false if it already exists.
 */
export function ensureConfigFile(filePath: string = CONFIG_FILE_PATH): boolean {
  if (fs.existsSync(filePath)) {
    migrateConfigFile(filePath);
    return false;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, generateDefaultConfigContent(), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Config migration
// ---------------------------------------------------------------------------

const SECTION_NAMES = new Set(["server", "claude", "operations"]);

interface ConfigKeyDef {
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
  { key: "claude", section: null, defaultLine: "# claude:" },
  { key: "path", section: "claude", defaultLine: "#   path: null           # null = auto-detect" },
  { key: "useCli", section: "claude", defaultLine: "#   useCli: true" },
  { key: "operations", section: null, defaultLine: "# operations:" },
  { key: "maxConcurrent", section: "operations", defaultLine: "#   maxConcurrent: 3" },
  { key: "claudeTimeoutMinutes", section: "operations", defaultLine: "#   claudeTimeoutMinutes: 20" },
  { key: "functionTimeoutMinutes", section: "operations", defaultLine: "#   functionTimeoutMinutes: 3" },
  { key: "defaultInteractionLevel", section: "operations", defaultLine: "#   defaultInteractionLevel: mid   # low / mid / high" },
  { key: "bestOfN", section: "operations", defaultLine: "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates" },
  { key: "editor", section: null, defaultLine: "# editor: code {path}" },
  { key: "terminal", section: null, defaultLine: "# terminal: open -a Terminal {path}" },
];

interface ParsedLine {
  type: "top-key" | "nested-key" | "other";
  key?: string;
  /** Indentation level (number of leading spaces) for nested keys. */
  indent?: number;
  commented: boolean;
}

function parseConfigLine(line: string): ParsedLine {
  const trimmed = line.trimStart();
  if (!trimmed || !trimmed.includes(":")) {
    return { type: "other", commented: false };
  }

  const isCommented = line.startsWith("#");
  // Remove '#' and at most one space after it (the comment marker space)
  const effective = isCommented ? line.replace(/^#\s?/, "") : line;

  // Nested key: starts with 2+ spaces then word then colon
  const nestedMatch = effective.match(/^(\s{2,})([\w-]+)\s*:/);
  if (nestedMatch) {
    return { type: "nested-key", key: nestedMatch[2], indent: nestedMatch[1].length, commented: isCommented };
  }

  // Top-level key: starts with word char at column 0
  const topMatch = effective.match(/^([\w-]+)\s*:/);
  if (topMatch) {
    return { type: "top-key", key: topMatch[1], commented: isCommented };
  }

  return { type: "other", commented: false };
}

/**
 * Find the last line index that belongs to a section (header or nested key).
 * Returns -1 if the section is not found.
 */
function findSectionEnd(lines: string[], sectionName: string): number {
  let inSection = false;
  let lastSectionLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseConfigLine(lines[i]);
    if (parsed.type === "top-key" && parsed.key === sectionName) {
      inSection = true;
      lastSectionLine = i;
    } else if (inSection) {
      if (parsed.type === "nested-key") {
        lastSectionLine = i;
      } else if (parsed.type === "top-key") {
        break; // New top-level key = section ended
      }
    }
  }

  return lastSectionLine;
}

/**
 * Migrate config file content: comment out unknown active keys, add missing
 * known keys as commented-out entries.
 *
 * Pure function — no I/O.
 */
export function migrateConfigContent(content: string): string {
  let lines = content.split("\n");

  // --- Phase 1: Comment out unknown active keys ---
  lines = commentOutUnknownKeys(lines);

  // --- Phase 2: Add missing entries ---
  lines = addMissingEntries(lines);

  // --- Phase 3: Add per-type override hint if operations section exists ---
  lines = addTypeOverrideHint(lines);

  return lines.join("\n");
}

/** Per-type override hint comment marker (used to detect if hint is already present). */
const TYPE_OVERRIDE_HINT_MARKER = "Per-operation-type overrides";

const TYPE_OVERRIDE_HINT_LINES = [
  "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
  "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
  "#   #   claudeTimeoutMinutes: 20",
  "#   #   functionTimeoutMinutes: 3",
  "#   #   defaultInteractionLevel: mid",
  "#   #   bestOfN: 0",
];

/**
 * If the operations section exists but has no (or outdated) per-type override
 * hint comment, insert/replace it at the end of the section.
 */
function addTypeOverrideHint(lines: string[]): string[] {
  // Check if the operations section exists
  const hasOperations = lines.some((line) => {
    const parsed = parseConfigLine(line);
    return parsed.type === "top-key" && parsed.key === "operations";
  });
  if (!hasOperations) return lines;

  const result = [...lines];

  // Find and remove any existing hint block (marker line + consecutive `#   #` lines after it)
  const markerIdx = result.findIndex((line) => line.includes(TYPE_OVERRIDE_HINT_MARKER));
  if (markerIdx >= 0) {
    let end = markerIdx + 1;
    while (end < result.length && result[end].startsWith("#   #")) {
      end++;
    }
    // Check if the existing block already matches the desired content
    const existing = result.slice(markerIdx, end);
    if (
      existing.length === TYPE_OVERRIDE_HINT_LINES.length &&
      existing.every((line, i) => line === TYPE_OVERRIDE_HINT_LINES[i])
    ) {
      return lines; // Already up to date
    }
    result.splice(markerIdx, end - markerIdx);
  }

  // Find the end of the operations section and insert the hint
  const endLine = findSectionEnd(result, "operations");
  if (endLine < 0) return lines;

  result.splice(endLine + 1, 0, ...TYPE_OVERRIDE_HINT_LINES);
  return result;
}

function commentOutUnknownKeys(lines: string[]): string[] {
  let currentSection: string | null = null;
  let sectionCommentedOut = false;
  // Track operation-type sub-section within "operations" (e.g., "review", "execute")
  let opsSubSection: string | null = null;

  return lines.map((line) => {
    const parsed = parseConfigLine(line);

    if (parsed.type === "top-key") {
      sectionCommentedOut = false;
      opsSubSection = null;
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
      if (!parsed.commented) {
        const isKnown = KNOWN_CONFIG_KEYS.some(
          (k) => k.section === null && k.key === parsed.key!,
        );
        if (!isKnown) {
          // If this is a section-like header (key with no inline value), mark children
          if (/^[\w-]+\s*:\s*$/.test(line)) {
            sectionCommentedOut = true;
          }
          return `# ${line}`;
        }
      }
    } else if (parsed.type === "nested-key") {
      if (!parsed.commented) {
        if (sectionCommentedOut) {
          return `# ${line}`;
        }
        if (currentSection === "operations") {
          // Check for operation-type sub-section headers (2-space indent)
          if (parsed.indent === 2 && OPERATION_TYPE_NAMES.has(parsed.key!)) {
            opsSubSection = parsed.key!;
            return line; // Valid sub-section header
          }
          // Check for keys inside an operation-type sub-section (4+ space indent)
          if (opsSubSection && parsed.indent != null && parsed.indent >= 4) {
            if (OVERRIDABLE_SETTINGS_KEYS.has(parsed.key! as keyof OperationTypeSettings)) {
              return line; // Valid overridable setting
            }
            return `# ${line}`; // Unknown key inside sub-section
          }
          // Regular operations nested key (2-space indent, not a sub-section)
          if (parsed.indent === 2) {
            opsSubSection = null; // Left the sub-section
          }
          const isKnown = KNOWN_CONFIG_KEYS.some(
            (k) => k.section === "operations" && k.key === parsed.key!,
          );
          if (!isKnown && !OPERATION_TYPE_NAMES.has(parsed.key!)) {
            return `# ${line}`;
          }
        } else if (currentSection) {
          const isKnown = KNOWN_CONFIG_KEYS.some(
            (k) => k.section === currentSection && k.key === parsed.key!,
          );
          if (!isKnown) return `# ${line}`;
        }
      } else {
        // Track sub-section from commented lines too
        if (currentSection === "operations" && parsed.indent === 2) {
          if (OPERATION_TYPE_NAMES.has(parsed.key!)) {
            opsSubSection = parsed.key!;
          } else if (!OVERRIDABLE_SETTINGS_KEYS.has(parsed.key! as keyof OperationTypeSettings)
            && !KNOWN_CONFIG_KEYS.some((k) => k.section === "operations" && k.key === parsed.key!)) {
            opsSubSection = null;
          }
        }
      }
    }

    // Track section from commented headers too
    if (parsed.type === "top-key" && parsed.commented) {
      opsSubSection = null;
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
    }

    return line;
  });
}

function addMissingEntries(lines: string[]): string[] {
  // Scan for what exists (both active and commented)
  let currentSection: string | null = null;
  const found = new Set<string>();

  for (const line of lines) {
    const parsed = parseConfigLine(line);
    if (parsed.type === "top-key") {
      found.add(parsed.key!);
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
    } else if (parsed.type === "nested-key" && currentSection) {
      // Only track direct children (indent 2), not sub-section children (indent 4+)
      if (parsed.indent === 2) {
        found.add(`${currentSection}.${parsed.key!}`);
      }
    }
  }

  // Determine what's missing
  const missing = KNOWN_CONFIG_KEYS.filter((def) => {
    const id = def.section ? `${def.section}.${def.key}` : def.key;
    return !found.has(id);
  });

  if (missing.length === 0) return lines;

  const result = [...lines];

  // Missing sections (section header itself is missing)
  const missingSectionHeaders = new Set(
    missing
      .filter((m) => m.section === null && SECTION_NAMES.has(m.key))
      .map((m) => m.key),
  );

  // Missing nested entries in EXISTING sections
  const missingInExistingSection = missing.filter(
    (m) => m.section !== null && !missingSectionHeaders.has(m.section) && found.has(m.section),
  );

  // Missing top-level scalar entries
  const missingTopLevel = missing.filter(
    (m) => m.section === null && !SECTION_NAMES.has(m.key),
  );

  // Insert missing nested entries at end of their existing sections
  // Group by section
  const sectionInsertions = new Map<string, string[]>();
  for (const m of missingInExistingSection) {
    if (!sectionInsertions.has(m.section!)) {
      sectionInsertions.set(m.section!, []);
    }
    sectionInsertions.get(m.section!)!.push(m.defaultLine);
  }

  // Find insertion points and apply bottom-to-top
  const insertionPoints: { afterLine: number; linesToInsert: string[] }[] = [];
  for (const [section, insertLines] of sectionInsertions) {
    const endLine = findSectionEnd(result, section);
    if (endLine >= 0) {
      insertionPoints.push({ afterLine: endLine, linesToInsert: insertLines });
    }
  }

  insertionPoints.sort((a, b) => b.afterLine - a.afterLine);
  for (const { afterLine, linesToInsert } of insertionPoints) {
    result.splice(afterLine + 1, 0, ...linesToInsert);
  }

  // Append missing sections and top-level entries at end
  const appendLines: string[] = [];

  // Missing sections (header + all children)
  for (const sectionKey of missingSectionHeaders) {
    const header = KNOWN_CONFIG_KEYS.find(
      (k) => k.key === sectionKey && k.section === null,
    );
    if (header) {
      appendLines.push("");
      appendLines.push(header.defaultLine);
      const children = missing.filter((m) => m.section === sectionKey);
      for (const child of children) {
        appendLines.push(child.defaultLine);
      }
    }
  }

  // Missing top-level scalars
  for (const m of missingTopLevel) {
    appendLines.push(m.defaultLine);
  }

  if (appendLines.length > 0) {
    // Remove trailing empty lines before appending
    while (result.length > 0 && result[result.length - 1] === "") {
      result.pop();
    }
    result.push(...appendLines);
    result.push(""); // trailing newline
  }

  return result;
}

/**
 * Migrate a config file on disk. Returns true if changes were made.
 */
export function migrateConfigFile(filePath: string): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  const migrated = migrateConfigContent(content);
  if (migrated === content) return false;
  fs.writeFileSync(filePath, migrated, "utf-8");
  return true;
}

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
  const result = { ...raw } as Record<string, unknown>;

  if (result.operations && typeof result.operations === "object") {
    const ops = { ...result.operations as Record<string, unknown> };
    const typeOverrides: Record<string, Partial<OperationTypeSettings>> = {};

    for (const key of Object.keys(ops)) {
      if (OPERATION_TYPE_NAMES.has(key) && ops[key] && typeof ops[key] === "object") {
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
  if (port !== undefined || chatPort !== undefined) {
    result.server = {
      ...(port !== undefined && { port }),
      ...(chatPort !== undefined && { chatPort }),
    } as AppConfig["server"];
  }

  if (process.env.AIW_CLAUDE_PATH) {
    result.claude = {
      ...result.claude,
      path: process.env.AIW_CLAUDE_PATH,
    } as AppConfig["claude"];
  }
  if (process.env.AIW_CLAUDE_USE_CLI !== undefined) {
    result.claude = {
      ...result.claude,
      useCli: process.env.AIW_CLAUDE_USE_CLI !== "false",
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
      typeOverrides: mergedTypeOverrides,
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
  };
}

// ---------------------------------------------------------------------------
// Cached singleton (stored on globalThis to survive Next.js module isolation)
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as {
  __aiwAppConfig?: AppConfig | null;
  __aiwConfigFilePath?: string;
};

/**
 * Get the resolved app config (cached). Priority: env > config.yml > defaults.
 */
export function getConfig(): AppConfig {
  if (globalStore.__aiwAppConfig) return globalStore.__aiwAppConfig;
  const filePath = globalStore.__aiwConfigFilePath ?? CONFIG_FILE_PATH;
  const fileConfig = loadConfigFile(filePath);
  globalStore.__aiwAppConfig = mergeConfig(CONFIG_DEFAULTS, fileConfig, envOverrides());
  return globalStore.__aiwAppConfig;
}

/** Reset the cached config so the next getConfig() call reloads from disk. */
export function _resetConfig(): void {
  globalStore.__aiwAppConfig = null;
}

/** Override the config file path (for testing). Pass null to restore default. */
export function _setConfigFilePath(p: string | null): void {
  if (p === null) {
    delete globalStore.__aiwConfigFilePath;
  } else {
    globalStore.__aiwConfigFilePath = p;
  }
}
