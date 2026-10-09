import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "@/types/config";
import {
  CONFIG_DEFAULTS,
  loadConfigFile,
  mergeConfig,
  getConfig,
  getOperationConfig,
  normalizeRawConfig,
  _resetConfig,
  _setConfigFilePath,
  ensureConfigFile,
  generateDefaultConfigContent,
  migrateConfigContent,
  migrateConfigFile,
  validateOpeners,
} from "@/lib/config";

describe("loadConfigFile", () => {
  it("returns null for non-existent file", () => {
    expect(loadConfigFile("/tmp/does-not-exist-config.yml")).toBeNull();
  });

  it("parses a valid YAML file", async () => {
    const tmpPath = `/tmp/test-ai-workspace-config-${Date.now()}.yml`;
    const fs = await import("node:fs");
    fs.writeFileSync(tmpPath, "server:\n  port: 9999\n");
    try {
      const result = loadConfigFile(tmpPath);
      expect(result).not.toBeNull();
      expect((result as Partial<AppConfig>).server?.port).toBe(9999);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it("returns null for non-object YAML", async () => {
    const tmpPath = `/tmp/test-ai-workspace-config-bad-${Date.now()}.yml`;
    const fs = await import("node:fs");
    fs.writeFileSync(tmpPath, "just a string");
    try {
      const result = loadConfigFile(tmpPath);
      expect(result).toBeNull();
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it("returns null for empty file", async () => {
    const tmpPath = `/tmp/test-ai-workspace-config-empty-${Date.now()}.yml`;
    const fs = await import("node:fs");
    fs.writeFileSync(tmpPath, "");
    try {
      const result = loadConfigFile(tmpPath);
      expect(result).toBeNull();
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});

describe("normalizeRawConfig", () => {
  it("extracts operation type keys into typeOverrides", () => {
    const raw = {
      operations: {
        batchSize: 3,
        maxConcurrent: 5,
        review: { batchSize: 0 },
        execute: { claudeTimeoutMinutes: 30, batchSize: 5 },
      },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.batchSize).toBe(3);
    expect(result.operations?.maxConcurrent).toBe(5);
    expect(result.operations?.typeOverrides).toEqual({
      review: { batchSize: 0 },
      execute: { claudeTimeoutMinutes: 30, batchSize: 5 },
    });
    // Original operation type keys should be removed from operations root
    expect((result.operations as Record<string, unknown>).review).toBeUndefined();
    expect((result.operations as Record<string, unknown>).execute).toBeUndefined();
  });

  it("handles hyphenated operation type names", () => {
    const raw = {
      operations: {
        batchSize: 2,
        "create-pr": { batchSize: 0 },
        "update-todo": { claudeTimeoutMinutes: 10 },
      },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.typeOverrides?.["create-pr"]).toEqual({ batchSize: 0 });
    expect(result.operations?.typeOverrides?.["update-todo"]).toEqual({ claudeTimeoutMinutes: 10 });
  });

  it("returns config unchanged when no operations section", () => {
    const raw = { workspaceRoot: "/tmp/x" };
    const result = normalizeRawConfig(raw);
    expect(result.workspaceRoot).toBe("/tmp/x");
    expect(result.operations).toBeUndefined();
  });

  it("migrates legacy editor + terminal keys into openers", () => {
    const raw = { editor: "vim {path}", terminal: "open -a iTerm {path}" };
    const result = normalizeRawConfig(raw);
    expect(result.openers).toEqual([
      { name: "Editor (VSCode)", command: "vim {path}" },
      { name: "Terminal", command: "open -a iTerm {path}" },
    ]);
    // Legacy keys are stripped
    expect((result as Record<string, unknown>).editor).toBeUndefined();
    expect((result as Record<string, unknown>).terminal).toBeUndefined();
  });

  it("does not overwrite explicit openers when legacy keys are present", () => {
    const raw = {
      editor: "vim {path}",
      openers: [{ name: "Custom", command: "cursor {path}" }],
    };
    const result = normalizeRawConfig(raw);
    expect(result.openers).toEqual([{ name: "Custom", command: "cursor {path}" }]);
    expect((result as Record<string, unknown>).editor).toBeUndefined();
  });

  it("does not validate openers (validation is deferred to API)", () => {
    // Malformed openers must NOT throw at parse time — that would break
    // every API route that calls getConfig(). Validation runs in /api/config.
    expect(() =>
      normalizeRawConfig({
        openers: [{ name: "Bad", command: "code" }],
      }),
    ).not.toThrow();
  });
});

describe("validateOpeners", () => {
  it("accepts valid openers", () => {
    expect(() =>
      validateOpeners([
        { name: "Editor", command: "code {path}" },
        { name: "Term", command: "open {path}" },
      ]),
    ).not.toThrow();
  });

  it("throws when command is missing {path}", () => {
    expect(() => validateOpeners([{ name: "Bad", command: "code" }])).toThrow(
      /\{path\}/,
    );
  });

  it("throws when names are duplicated", () => {
    expect(() =>
      validateOpeners([
        { name: "Same", command: "a {path}" },
        { name: "Same", command: "b {path}" },
      ]),
    ).toThrow(/duplicated/);
  });

  it("throws when name is empty", () => {
    expect(() => validateOpeners([{ name: "  ", command: "a {path}" }])).toThrow(
      /non-empty/,
    );
  });

  it("throws when value is not an array", () => {
    expect(() => validateOpeners("nope" as unknown)).toThrow(/array/);
  });

  it("returns config unchanged when no type overrides present", () => {
    const raw = {
      operations: { batchSize: 3, maxConcurrent: 2 },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.batchSize).toBe(3);
    expect(result.operations?.typeOverrides).toBeUndefined();
  });

  it("ignores non-operation-type object keys", () => {
    const raw = {
      operations: {
        batchSize: 3,
        notAnOpType: { batchSize: 0 },
      },
    };
    const result = normalizeRawConfig(raw);
    // notAnOpType is not an operation type, should remain as-is
    expect((result.operations as Record<string, unknown>).notAnOpType).toEqual({ batchSize: 0 });
    expect(result.operations?.typeOverrides).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  it("returns defaults when file and env are empty", () => {
    const result = mergeConfig(CONFIG_DEFAULTS, null, {});
    expect(result).toEqual(CONFIG_DEFAULTS);
  });

  it("file config overrides defaults", () => {
    const fileConfig: Partial<AppConfig> = {
      server: { port: 8080, chatPort: 8081 },
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.server.port).toBe(8080);
    expect(result.server.chatPort).toBe(8081);
    // Other defaults preserved
    expect(result.claude.path).toBeNull();
    expect(result.operations.maxConcurrent).toBe(3);
  });

  it("env overrides file config", () => {
    const fileConfig: Partial<AppConfig> = {
      server: { port: 8080, chatPort: 8081 },
    };
    const env: Partial<AppConfig> = {
      server: { port: 9999 } as AppConfig["server"],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, env);
    expect(result.server.port).toBe(9999);
    // chatPort from file since env doesn't set it
    expect(result.server.chatPort).toBe(8081);
  });

  it("handles partial file config with nested fields", () => {
    const fileConfig: Partial<AppConfig> = {
      operations: {
        maxConcurrent: 5,
      } as AppConfig["operations"],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.operations.maxConcurrent).toBe(5);
    // Other operation defaults preserved
    expect(result.operations.claudeTimeoutMinutes).toBe(20);
    expect(result.operations.functionTimeoutMinutes).toBe(3);
    expect(result.operations.defaultInteractionLevel).toBe("mid");
  });

  // Arrays are replaced wholesale, not merged element-wise.
  it("file config replaces openers default", () => {
    const fileConfig: Partial<AppConfig> = {
      openers: [{ name: "Custom", command: "cursor {path}" }],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.openers).toEqual([{ name: "Custom", command: "cursor {path}" }]);
  });

  it("merges typeOverrides from file config", () => {
    const fileConfig: Partial<AppConfig> = {
      operations: {
        batchSize: 3,
        typeOverrides: {
          review: { batchSize: 0 },
          execute: { claudeTimeoutMinutes: 30 },
        },
      } as AppConfig["operations"],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.operations.batchSize).toBe(3);
    expect(result.operations.typeOverrides.review).toEqual({ batchSize: 0 });
    expect(result.operations.typeOverrides.execute).toEqual({ claudeTimeoutMinutes: 30 });
  });
});

describe("getConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "AIW_WORKSPACE_ROOT",
    "AIW_PORT",
    "AIW_CHAT_PORT",
    "AIW_CLAUDE_PATH",
    "AIW_DISABLE_ACCESS_LOG",
  ];

  beforeEach(() => {
    _resetConfig();
    // Point to a non-existent file so tests don't read the real user config
    _setConfigFilePath("/tmp/nonexistent-aiw-test-config.yml");
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    _resetConfig();
    _setConfigFilePath(null);
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("caches the config on repeated calls", () => {
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("picks up env vars", () => {
    process.env.AIW_PORT = "5555";
    process.env.AIW_CLAUDE_PATH = "/custom/claude";
    const config = getConfig();
    expect(config.server.port).toBe(5555);
    expect(config.claude.path).toBe("/custom/claude");
  });

  it("_resetConfig clears cache", () => {
    const first = getConfig();
    process.env.AIW_PORT = "6666";
    _resetConfig();
    const second = getConfig();
    expect(second.server.port).toBe(6666);
    expect(first).not.toBe(second);
  });

  it.each([
    [undefined, false],
    ["true", true],
    ["1", true],
    ["false", false],
  ])("reads AIW_DISABLE_ACCESS_LOG=%s as %s", (value, expected) => {
    if (value !== undefined) process.env.AIW_DISABLE_ACCESS_LOG = value;
    expect(getConfig().server.disableAccessLog).toBe(expected);
  });
});

describe("getOperationConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "AIW_WORKSPACE_ROOT",
    "AIW_PORT",
    "AIW_CHAT_PORT",
    "AIW_CLAUDE_PATH",
  ];

  beforeEach(() => {
    _resetConfig();
    _setConfigFilePath("/tmp/nonexistent-aiw-test-config.yml");
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    _resetConfig();
    _setConfigFilePath(null);
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns per-type overrides from config file", async () => {
    const fs = await import("node:fs");
    const tmpPath = `/tmp/test-aiw-opconfig-${Date.now()}.yml`;
    const yaml = [
      "operations:",
      "  batchSize: 3",
      "  review:",
      "    batchSize: 0",
      "  execute:",
      "    claudeTimeoutMinutes: 30",
      "    batchSize: 5",
      "",
    ].join("\n");
    fs.writeFileSync(tmpPath, yaml);
    _setConfigFilePath(tmpPath);
    try {
      // Review: batchSize overridden to 0, others inherit global
      const reviewCfg = getOperationConfig("review");
      expect(reviewCfg.batchSize).toBe(0);
      expect(reviewCfg.claudeTimeoutMinutes).toBe(20); // global default

      // Execute: both batchSize and claudeTimeoutMinutes overridden
      const execCfg = getOperationConfig("execute");
      expect(execCfg.batchSize).toBe(5);
      expect(execCfg.claudeTimeoutMinutes).toBe(30);

      // Init: no per-type override, uses global batchSize=3
      const initCfg = getOperationConfig("init");
      expect(initCfg.batchSize).toBe(3);
      expect(initCfg.claudeTimeoutMinutes).toBe(20);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});

describe("ensureConfigFile", () => {
  it("creates config file when it does not exist", async () => {
    const fs = await import("node:fs");
    const tmpDir = `/tmp/test-aiw-config-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.yml`;
    try {
      const created = ensureConfigFile(tmpPath);
      expect(created).toBe(true);
      expect(fs.existsSync(tmpPath)).toBe(true);
      const content = fs.readFileSync(tmpPath, "utf-8");
      expect(content).toContain("# ai-workspace configuration");
      expect(content).toContain("# openers:");
      expect(content).toContain("#   - name: Editor (VSCode)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("migrates existing config file on ensure", async () => {
    const fs = await import("node:fs");
    const tmpDir = `/tmp/test-aiw-config-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.yml`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpPath, "editor: vim {path}\n");
    try {
      const created = ensureConfigFile(tmpPath);
      expect(created).toBe(false);
      const content = fs.readFileSync(tmpPath, "utf-8");
      // Legacy `editor:` key is left intact (runtime auto-migrates it to openers)
      expect(content).toContain("editor: vim {path}");
      // Missing known sections are added as comments
      expect(content).toContain("# openers:");
      expect(content).toContain("# operations:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("migrateConfigContent", () => {
  it("returns unchanged content when all keys present", () => {
    const content = generateDefaultConfigContent();
    expect(migrateConfigContent(content)).toBe(content);
  });

  it("adds missing nested key as comment at end of section", () => {
    const content = [
      "operations:",
      "  maxConcurrent: 3",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // batchSize and other missing ops keys should be added in the operations section
    expect(result).toContain("#   batchSize:");
    expect(result).toContain("#   claudeTimeoutMinutes:");
    // maxConcurrent should remain active
    expect(result).toContain("  maxConcurrent: 3");
    // The missing ops keys should appear between maxConcurrent and the blank line (or after)
    const lines = result.split("\n");
    const maxConcIdx = lines.findIndex((l) => l.includes("maxConcurrent: 3"));
    const batchSizeIdx = lines.findIndex((l) => l.includes("batchSize:"));
    expect(batchSizeIdx).toBeGreaterThan(maxConcIdx);
  });

  it("comments out unknown active top-level key", () => {
    const content = [
      "unknownSetting: value",
      "editor: code {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("# unknownSetting: value");
    // Known key preserved as active
    expect(result).toContain("editor: code {path}");
  });

  it("comments out unknown active nested key", () => {
    const content = [
      "operations:",
      "  maxConcurrent: 3",
      "  oldSetting: true",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("#   oldSetting: true");
    expect(result).toContain("  maxConcurrent: 3");
  });

  it("preserves active known keys unchanged", () => {
    const content = [
      "editor: vim {path}",
      "terminal: open -a iTerm {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("editor: vim {path}");
    expect(result).toContain("terminal: open -a iTerm {path}");
  });

  it("preserves commented known keys unchanged", () => {
    const content = [
      "# editor: code {path}",
      "# terminal: open -a Terminal {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("# editor: code {path}");
    expect(result).toContain("# terminal: open -a Terminal {path}");
  });

  it("adds missing section with all its keys", () => {
    const content = [
      "editor: code {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // operations section should be added
    expect(result).toContain("# operations:");
    expect(result).toContain("#   maxConcurrent:");
    expect(result).toContain("#   batchSize:");
    // server and claude sections too
    expect(result).toContain("# server:");
    expect(result).toContain("#   port:");
    expect(result).toContain("# claude:");
    expect(result).toContain("#   path:");
  });

  it("comments out children of unknown section header", () => {
    const content = [
      "oldSection:",
      "  oldChild: value",
      "  anotherChild: 42",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("# oldSection:");
    expect(result).toContain("#   oldChild: value");
    expect(result).toContain("#   anotherChild: 42");
  });

  it("preserves user comments and blank lines", () => {
    const content = [
      "# ai-workspace configuration",
      "# My custom note",
      "",
      "editor: vim {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("# ai-workspace configuration");
    expect(result).toContain("# My custom note");
    expect(result).toContain("editor: vim {path}");
  });

  it("handles fully active config file", () => {
    const content = [
      "workspaceRoot: /my/workspace",
      "",
      "server:",
      "  port: 3741",
      "  chatPort: 3742",
      "  disableAccessLog: false",
      "",
      "claude:",
      "  path: null",
      "",
      "operations:",
      "  maxConcurrent: 3",
      "  maxGroupConcurrency: 8",
      "  claudeTimeoutMinutes: 20",
      "  functionTimeoutMinutes: 3",
      "  defaultInteractionLevel: mid",
      "  batchSize: 10",
      "  model: null",
      "  effort: null",
      "#   # Built-in step defaults. Model and effort form one ladder with exactly",
      "#   # five rungs; override either via steps.<step-type>.{model,effort}:",
      "#   #   opus / high   — a short call whose wrong answer costs a cycle:",
      "#   #           autonomous-gate",
      "#   #   opus / medium — the default rung, open-ended work included:",
      "#   #           analyze-readme, plan-todo, research, coordinate-todos,",
      "#   #           update-todo, execute, code-review, verify-readme,",
      "#   #           criteria-feasibility, validate-pr-comment, ground-finding,",
      "#   #           resolve-conflicts, update-readme, plan-todo-from-review,",
      "#   #           review-todos, suggest-workspace",
      "#   #   opus / low    — a step above mechanical:",
      "#   #           discover-constraints, readme-clarity-gate, verify-fixes",
      "#   #   claude-sonnet-5-5 / low — mechanical, or bounded with nothing to judge:",
      "#   #           verify-todo, deep-search, create-pr",
      "#   #   claude-haiku-5-5 / low  — reshaping text already handed over:",
      "#   #           prune-suggestions, collect-reviews, aggregate-suggestions",
      "#   # Per-operation-type overrides (any setting above except the two concurrency caps):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   batchSize: 15",
      "#   #   model: sonnet",
      "#   #   effort: high",
      "#   #   steps:",
      "#   #     <step-type>:",
      "#   #       model: haiku",
      "#   #       effort: low",
      "",
      "chat:",
      "  model: sonnet",
      "",
      "openers:",
      "  - name: Editor (VSCode)",
      "    command: code {path}",
      "  - name: Terminal",
      "    command: open -a Terminal {path}",
      "",
      "suggest:",
      "  enabled: true",
      "",
      "hooks:",
      "  sessionStartGitContext: true",
      "  blockDangerousBash: true",
      "",
      "slack:",
      "  enabled: false",
      "  botToken: \"{ENV:AIW_SLACK_BOT_TOKEN}\"",
      "  appToken: \"{ENV:AIW_SLACK_APP_TOKEN}\"",
      "  allowedUserIds: []",
      "  chatModel: sonnet",
      "  chatEffort: medium",
      "  chatHeartbeatMs: 180000",
      "  chatMaxTurnMs: 1080000",
      "  chatProgressModel: haiku",
      "  memoryEnabled: true",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // All keys present — no changes
    expect(result).toBe(content);
  });

  it("adds missing keys to partially filled section", () => {
    const content = [
      "server:",
      "  port: 9999",
      "",
      "editor: code {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // chatPort should be added to server section
    expect(result).toContain("#   chatPort:");
    // port stays active
    expect(result).toContain("  port: 9999");
    // chatPort should be in the server section (before editor)
    const lines = result.split("\n");
    const chatPortIdx = lines.findIndex((l) => l.includes("chatPort:"));
    const editorIdx = lines.findIndex((l) => l.includes("editor:"));
    expect(chatPortIdx).toBeLessThan(editorIdx);
  });

  it("preserves per-operation-type override sections", () => {
    const content = [
      "operations:",
      "  batchSize: 3",
      "  review:",
      "    batchSize: 0",
      "  execute:",
      "    claudeTimeoutMinutes: 30",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // Per-type override sections should be preserved
    expect(result).toContain("  review:");
    expect(result).toContain("    batchSize: 0");
    expect(result).toContain("  execute:");
    expect(result).toContain("    claudeTimeoutMinutes: 30");
    // Global settings still present
    expect(result).toContain("  batchSize: 3");
  });

  it("comments out unknown keys inside per-type override sections", () => {
    const content = [
      "operations:",
      "  batchSize: 3",
      "  review:",
      "    batchSize: 0",
      "    unknownSetting: true",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // Valid key preserved
    expect(result).toContain("    batchSize: 0");
    // Unknown key commented out
    expect(result).toContain("#     unknownSetting: true");
  });
});

describe("migrateConfigFile", () => {
  it("returns false when no changes needed", async () => {
    const fs = await import("node:fs");
    const tmpDir = `/tmp/test-aiw-migrate-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.yml`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpPath, generateDefaultConfigContent());
    try {
      const changed = migrateConfigFile(tmpPath);
      expect(changed).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes migrated content and returns true when changes needed", async () => {
    const fs = await import("node:fs");
    const tmpDir = `/tmp/test-aiw-migrate-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.yml`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpPath, "editor: vim {path}\n");
    try {
      const changed = migrateConfigFile(tmpPath);
      expect(changed).toBe(true);
      const content = fs.readFileSync(tmpPath, "utf-8");
      // Legacy `editor:` is preserved (runtime auto-migrates)
      expect(content).toContain("editor: vim {path}");
      expect(content).toContain("# openers:");
      expect(content).toContain("# operations:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
