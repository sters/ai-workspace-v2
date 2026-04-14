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
} from "@/lib/config";

describe("CONFIG_DEFAULTS", () => {
  it("has expected default values", () => {
    expect(CONFIG_DEFAULTS.workspaceRoot).toBeNull();
    expect(CONFIG_DEFAULTS.server.port).toBe(3741);
    expect(CONFIG_DEFAULTS.server.chatPort).toBe(3742);
    expect(CONFIG_DEFAULTS.claude.path).toBeNull();
    expect(CONFIG_DEFAULTS.claude.useCli).toBe(true);
    expect(CONFIG_DEFAULTS.operations.maxConcurrent).toBe(3);
    expect(CONFIG_DEFAULTS.operations.claudeTimeoutMinutes).toBe(20);
    expect(CONFIG_DEFAULTS.operations.functionTimeoutMinutes).toBe(3);
    expect(CONFIG_DEFAULTS.operations.defaultInteractionLevel).toBe("mid");
    expect(CONFIG_DEFAULTS.operations.typeOverrides).toEqual({});
    expect(CONFIG_DEFAULTS.editor).toBe("code {path}");
    expect(CONFIG_DEFAULTS.terminal).toBe("open -a Terminal {path}");
  });
});

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

  it("extracts per-operation-type overrides from YAML", async () => {
    const tmpPath = `/tmp/test-ai-workspace-config-overrides-${Date.now()}.yml`;
    const fs = await import("node:fs");
    const yaml = [
      "operations:",
      "  bestOfN: 3",
      "  review:",
      "    bestOfN: 0",
      "  execute:",
      "    claudeTimeoutMinutes: 30",
      "",
    ].join("\n");
    fs.writeFileSync(tmpPath, yaml);
    try {
      const result = loadConfigFile(tmpPath);
      expect(result).not.toBeNull();
      expect(result!.operations?.bestOfN).toBe(3);
      expect(result!.operations?.typeOverrides?.review).toEqual({ bestOfN: 0 });
      expect(result!.operations?.typeOverrides?.execute).toEqual({ claudeTimeoutMinutes: 30 });
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});

describe("normalizeRawConfig", () => {
  it("extracts operation type keys into typeOverrides", () => {
    const raw = {
      operations: {
        bestOfN: 3,
        maxConcurrent: 5,
        review: { bestOfN: 0 },
        execute: { claudeTimeoutMinutes: 30, bestOfN: 5 },
      },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.bestOfN).toBe(3);
    expect(result.operations?.maxConcurrent).toBe(5);
    expect(result.operations?.typeOverrides).toEqual({
      review: { bestOfN: 0 },
      execute: { claudeTimeoutMinutes: 30, bestOfN: 5 },
    });
    // Original operation type keys should be removed from operations root
    expect((result.operations as Record<string, unknown>).review).toBeUndefined();
    expect((result.operations as Record<string, unknown>).execute).toBeUndefined();
  });

  it("handles hyphenated operation type names", () => {
    const raw = {
      operations: {
        bestOfN: 2,
        "create-pr": { bestOfN: 0 },
        "update-todo": { claudeTimeoutMinutes: 10 },
      },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.typeOverrides?.["create-pr"]).toEqual({ bestOfN: 0 });
    expect(result.operations?.typeOverrides?.["update-todo"]).toEqual({ claudeTimeoutMinutes: 10 });
  });

  it("returns config unchanged when no operations section", () => {
    const raw = { editor: "vim {path}" };
    const result = normalizeRawConfig(raw);
    expect(result.editor).toBe("vim {path}");
    expect(result.operations).toBeUndefined();
  });

  it("returns config unchanged when no type overrides present", () => {
    const raw = {
      operations: { bestOfN: 3, maxConcurrent: 2 },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.bestOfN).toBe(3);
    expect(result.operations?.typeOverrides).toBeUndefined();
  });

  it("ignores non-operation-type object keys", () => {
    const raw = {
      operations: {
        bestOfN: 3,
        notAnOpType: { bestOfN: 0 },
      },
    };
    const result = normalizeRawConfig(raw);
    // notAnOpType is not an operation type, should remain as-is
    expect((result.operations as Record<string, unknown>).notAnOpType).toEqual({ bestOfN: 0 });
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
    expect(result.claude.useCli).toBe(true);
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

  it("env overrides defaults when no file config", () => {
    const env: Partial<AppConfig> = {
      workspaceRoot: "/my/root",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, null, env);
    expect(result.workspaceRoot).toBe("/my/root");
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

  it("merges all layers correctly for claude config", () => {
    const fileConfig: Partial<AppConfig> = {
      claude: { path: "/usr/bin/claude", useCli: false },
    };
    const env: Partial<AppConfig> = {
      claude: { useCli: true } as AppConfig["claude"],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, env);
    // env wins for useCli
    expect(result.claude.useCli).toBe(true);
    // file wins for path (env didn't set it)
    expect(result.claude.path).toBe("/usr/bin/claude");
  });

  it("handles workspaceRoot from file", () => {
    const fileConfig: Partial<AppConfig> = {
      workspaceRoot: "/from/file",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.workspaceRoot).toBe("/from/file");
  });

  it("file config overrides editor default", () => {
    const fileConfig: Partial<AppConfig> = {
      editor: "vim {path}",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.editor).toBe("vim {path}");
  });

  it("env overrides editor from file", () => {
    const fileConfig: Partial<AppConfig> = {
      editor: "vim {path}",
    };
    const env: Partial<AppConfig> = {
      editor: "nvim {path}",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, env);
    expect(result.editor).toBe("nvim {path}");
  });

  it("file config overrides terminal default", () => {
    const fileConfig: Partial<AppConfig> = {
      terminal: "open -a iTerm {path}",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.terminal).toBe("open -a iTerm {path}");
  });

  it("env overrides terminal from file", () => {
    const fileConfig: Partial<AppConfig> = {
      terminal: "open -a iTerm {path}",
    };
    const env: Partial<AppConfig> = {
      terminal: "warp {path}",
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, env);
    expect(result.terminal).toBe("warp {path}");
  });

  it("merges typeOverrides from file config", () => {
    const fileConfig: Partial<AppConfig> = {
      operations: {
        bestOfN: 3,
        typeOverrides: {
          review: { bestOfN: 0 },
          execute: { claudeTimeoutMinutes: 30 },
        },
      } as AppConfig["operations"],
    };
    const result = mergeConfig(CONFIG_DEFAULTS, fileConfig, {});
    expect(result.operations.bestOfN).toBe(3);
    expect(result.operations.typeOverrides.review).toEqual({ bestOfN: 0 });
    expect(result.operations.typeOverrides.execute).toEqual({ claudeTimeoutMinutes: 30 });
  });

  it("defaults typeOverrides to empty when not in file", () => {
    const result = mergeConfig(CONFIG_DEFAULTS, null, {});
    expect(result.operations.typeOverrides).toEqual({});
  });
});

describe("getConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "AIW_WORKSPACE_ROOT",
    "AIW_PORT",
    "AIW_CHAT_PORT",
    "AIW_CLAUDE_PATH",
    "AIW_CLAUDE_USE_CLI",
    "AIW_EDITOR",
    "AIW_TERMINAL",
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

  it("returns default config when no file or env vars", () => {
    const config = getConfig();
    expect(config.server.port).toBe(3741);
    expect(config.server.chatPort).toBe(3742);
    expect(config.claude.useCli).toBe(true);
    expect(config.operations.maxConcurrent).toBe(3);
  });

  it("caches the config on repeated calls", () => {
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("picks up env vars", () => {
    process.env.AIW_PORT = "5555";
    process.env.AIW_CLAUDE_USE_CLI = "false";
    const config = getConfig();
    expect(config.server.port).toBe(5555);
    expect(config.claude.useCli).toBe(false);
  });

  it("_resetConfig clears cache", () => {
    const first = getConfig();
    process.env.AIW_PORT = "6666";
    _resetConfig();
    const second = getConfig();
    expect(second.server.port).toBe(6666);
    expect(first).not.toBe(second);
  });

  it("picks up AIW_EDITOR env var", () => {
    process.env.AIW_EDITOR = "cursor {path}";
    const config = getConfig();
    expect(config.editor).toBe("cursor {path}");
  });

  it("defaults editor to code {path}", () => {
    const config = getConfig();
    expect(config.editor).toBe("code {path}");
  });

  it("picks up AIW_TERMINAL env var", () => {
    process.env.AIW_TERMINAL = "open -a iTerm {path}";
    const config = getConfig();
    expect(config.terminal).toBe("open -a iTerm {path}");
  });

  it("defaults terminal to open -a Terminal {path}", () => {
    const config = getConfig();
    expect(config.terminal).toBe("open -a Terminal {path}");
  });

  it("defaults disableAccessLog to false", () => {
    const config = getConfig();
    expect(config.server.disableAccessLog).toBe(false);
  });

  it("picks up AIW_DISABLE_ACCESS_LOG env var (true)", () => {
    process.env.AIW_DISABLE_ACCESS_LOG = "true";
    const config = getConfig();
    expect(config.server.disableAccessLog).toBe(true);
  });

  it("AIW_DISABLE_ACCESS_LOG=false keeps it false", () => {
    process.env.AIW_DISABLE_ACCESS_LOG = "false";
    const config = getConfig();
    expect(config.server.disableAccessLog).toBe(false);
  });

  it("AIW_DISABLE_ACCESS_LOG=1 enables it", () => {
    process.env.AIW_DISABLE_ACCESS_LOG = "1";
    const config = getConfig();
    expect(config.server.disableAccessLog).toBe(true);
  });
});

describe("getOperationConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "AIW_WORKSPACE_ROOT",
    "AIW_PORT",
    "AIW_CHAT_PORT",
    "AIW_CLAUDE_PATH",
    "AIW_CLAUDE_USE_CLI",
    "AIW_EDITOR",
    "AIW_TERMINAL",
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

  it("returns global defaults when no per-type overrides", () => {
    const result = getOperationConfig("execute");
    expect(result.bestOfN).toBe(0);
    expect(result.claudeTimeoutMinutes).toBe(20);
    expect(result.functionTimeoutMinutes).toBe(3);
    expect(result.defaultInteractionLevel).toBe("mid");
  });

  it("returns per-type overrides from config file", async () => {
    const fs = await import("node:fs");
    const tmpPath = `/tmp/test-aiw-opconfig-${Date.now()}.yml`;
    const yaml = [
      "operations:",
      "  bestOfN: 3",
      "  review:",
      "    bestOfN: 0",
      "  execute:",
      "    claudeTimeoutMinutes: 30",
      "    bestOfN: 5",
      "",
    ].join("\n");
    fs.writeFileSync(tmpPath, yaml);
    _setConfigFilePath(tmpPath);
    try {
      // Review: bestOfN overridden to 0, others inherit global
      const reviewCfg = getOperationConfig("review");
      expect(reviewCfg.bestOfN).toBe(0);
      expect(reviewCfg.claudeTimeoutMinutes).toBe(20); // global default

      // Execute: both bestOfN and claudeTimeoutMinutes overridden
      const execCfg = getOperationConfig("execute");
      expect(execCfg.bestOfN).toBe(5);
      expect(execCfg.claudeTimeoutMinutes).toBe(30);

      // Init: no per-type override, uses global bestOfN=3
      const initCfg = getOperationConfig("init");
      expect(initCfg.bestOfN).toBe(3);
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
      expect(content).toContain("# editor:");
      expect(content).toContain("# terminal:");
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
      // User's active value is preserved
      expect(content).toContain("editor: vim {path}");
      // Missing keys are added as comments
      expect(content).toContain("# terminal:");
      expect(content).toContain("# operations:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("generateDefaultConfigContent", () => {
  it("contains all config sections as comments", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("# workspaceRoot:");
    expect(content).toContain("# server:");
    expect(content).toContain("#   port: 3741");
    expect(content).toContain("# claude:");
    expect(content).toContain("# operations:");
    expect(content).toContain("# editor:");
    expect(content).toContain("# terminal:");
  });

  it("contains per-operation-type override reference", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("Per-operation-type overrides");
    expect(content).toContain("#   # <operation-type>:");
    expect(content).toContain("#   #   claudeTimeoutMinutes:");
    expect(content).toContain("#   #   functionTimeoutMinutes:");
    expect(content).toContain("#   #   defaultInteractionLevel:");
    expect(content).toContain("#   #   bestOfN:");
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
    // bestOfN and other missing ops keys should be added in the operations section
    expect(result).toContain("#   bestOfN:");
    expect(result).toContain("#   claudeTimeoutMinutes:");
    // maxConcurrent should remain active
    expect(result).toContain("  maxConcurrent: 3");
    // The missing ops keys should appear between maxConcurrent and the blank line (or after)
    const lines = result.split("\n");
    const maxConcIdx = lines.findIndex((l) => l.includes("maxConcurrent: 3"));
    const bestOfNIdx = lines.findIndex((l) => l.includes("bestOfN:"));
    expect(bestOfNIdx).toBeGreaterThan(maxConcIdx);
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
    expect(result).toContain("#   bestOfN:");
    // server and claude sections too
    expect(result).toContain("# server:");
    expect(result).toContain("#   port:");
    expect(result).toContain("# claude:");
    expect(result).toContain("#   useCli:");
  });

  it("handles both commenting out and adding in same migration", () => {
    const content = [
      "operations:",
      "  maxConcurrent: 3",
      "  deprecatedKey: old",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // Unknown key commented out
    expect(result).toContain("#   deprecatedKey: old");
    // Missing keys added
    expect(result).toContain("#   bestOfN:");
    expect(result).toContain("#   claudeTimeoutMinutes:");
    // Active known key preserved
    expect(result).toContain("  maxConcurrent: 3");
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
      "  useCli: true",
      "",
      "operations:",
      "  maxConcurrent: 3",
      "  claudeTimeoutMinutes: 20",
      "  functionTimeoutMinutes: 3",
      "  defaultInteractionLevel: mid",
      "  bestOfN: 0",
      "  batchSize: 10",
      "  model: null",
      "#   # Built-in step defaults (override via steps.<step-type>.model):",
      "#   #   sonnet: create-pr, coordinate-todos, review-todos, best-of-n-reviewer,",
      "#   #           plan-todo-from-review, discover-constraints, autonomous-gate,",
      "#   #           verify-readme, code-review",
      "#   #   haiku:  collect-reviews, verify-todo, deep-search",
      "#   #   (all others: CLI default)",
      "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   bestOfN: 0",
      "#   #   batchSize: 10",
      "#   #   model: sonnet",
      "#   #   steps:",
      "#   #     <step-type>:",
      "#   #       model: haiku",
      "",
      "chat:",
      "  model: sonnet",
      "",
      "quickAsk:",
      "  model: haiku",
      "  allowedTools: [Read, Glob, Grep, WebFetch, WebSearch]",
      "",
      "editor: code {path}",
      "terminal: open -a Terminal {path}",
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
      "  bestOfN: 3",
      "  review:",
      "    bestOfN: 0",
      "  execute:",
      "    claudeTimeoutMinutes: 30",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // Per-type override sections should be preserved
    expect(result).toContain("  review:");
    expect(result).toContain("    bestOfN: 0");
    expect(result).toContain("  execute:");
    expect(result).toContain("    claudeTimeoutMinutes: 30");
    // Global settings still present
    expect(result).toContain("  bestOfN: 3");
  });

  it("comments out unknown keys inside per-type override sections", () => {
    const content = [
      "operations:",
      "  bestOfN: 3",
      "  review:",
      "    bestOfN: 0",
      "    unknownSetting: true",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // Valid key preserved
    expect(result).toContain("    bestOfN: 0");
    // Unknown key commented out
    expect(result).toContain("#     unknownSetting: true");
  });

  it("preserves config with per-type overrides and all keys present", () => {
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
      "  useCli: true",
      "",
      "operations:",
      "  maxConcurrent: 3",
      "  claudeTimeoutMinutes: 20",
      "  functionTimeoutMinutes: 3",
      "  defaultInteractionLevel: mid",
      "  bestOfN: 3",
      "  batchSize: 10",
      "  model: null",
      "  review:",
      "    bestOfN: 0",
      "#   # Built-in step defaults (override via steps.<step-type>.model):",
      "#   #   sonnet: create-pr, coordinate-todos, review-todos, best-of-n-reviewer,",
      "#   #           plan-todo-from-review, discover-constraints, autonomous-gate,",
      "#   #           verify-readme, code-review",
      "#   #   haiku:  collect-reviews, verify-todo, deep-search",
      "#   #   (all others: CLI default)",
      "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   bestOfN: 0",
      "#   #   batchSize: 10",
      "#   #   model: sonnet",
      "#   #   steps:",
      "#   #     <step-type>:",
      "#   #       model: haiku",
      "",
      "chat:",
      "  model: sonnet",
      "",
      "quickAsk:",
      "  model: haiku",
      "  allowedTools: [Read, Glob, Grep, WebFetch, WebSearch]",
      "",
      "editor: code {path}",
      "terminal: open -a Terminal {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    // All keys present including per-type overrides — no changes
    expect(result).toBe(content);
  });

  it("preserves hyphenated operation type names in overrides", () => {
    const content = [
      "operations:",
      "  bestOfN: 3",
      "  create-pr:",
      "    bestOfN: 0",
      "  update-todo:",
      "    claudeTimeoutMinutes: 10",
      "",
    ].join("\n");
    const result = migrateConfigContent(content);
    expect(result).toContain("  create-pr:");
    expect(result).toContain("    bestOfN: 0");
    expect(result).toContain("  update-todo:");
    expect(result).toContain("    claudeTimeoutMinutes: 10");
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
      expect(content).toContain("editor: vim {path}");
      expect(content).toContain("# terminal:");
      expect(content).toContain("# operations:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
