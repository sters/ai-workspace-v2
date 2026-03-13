import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "@/types/config";
import {
  CONFIG_DEFAULTS,
  loadConfigFile,
  mergeConfig,
  getConfig,
  _resetConfig,
  ensureConfigFile,
  generateDefaultConfigContent,
} from "@/lib/app-config";

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
  ];

  beforeEach(() => {
    _resetConfig();
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    _resetConfig();
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

  it("does not overwrite existing config file", async () => {
    const fs = await import("node:fs");
    const tmpDir = `/tmp/test-aiw-config-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.yml`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpPath, "editor: vim {path}\n");
    try {
      const created = ensureConfigFile(tmpPath);
      expect(created).toBe(false);
      const content = fs.readFileSync(tmpPath, "utf-8");
      expect(content).toBe("editor: vim {path}\n");
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
});
