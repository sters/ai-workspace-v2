import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyManagedHooks, syncManagedHooks } from "@/lib/claude/hooks/sync";
import { MANAGED_COMMAND_PREFIX, MANAGED_SCRIPT_NAMES } from "@/lib/claude/hooks/scripts";
import { _resetConfig, setWorkspaceRoot, _resetWorkspaceRoot } from "@/lib/config";

describe("applyManagedHooks", () => {
  it("writes both managed groups when both flags are true", () => {
    const out = applyManagedHooks({}, { sessionStartGitContext: true, blockDangerousBash: true });
    expect(out.hooks?.PreToolUse).toHaveLength(1);
    expect(out.hooks?.SessionStart).toHaveLength(1);
    expect(out.hooks?.PreToolUse?.[0].hooks[0].command).toBe(
      `${MANAGED_COMMAND_PREFIX}${MANAGED_SCRIPT_NAMES.blockDangerousBash.slice("aiw-".length)}`,
    );
  });

  it("removes managed groups when flags are false", () => {
    const initial = applyManagedHooks({}, { sessionStartGitContext: true, blockDangerousBash: true });
    const out = applyManagedHooks(initial, { sessionStartGitContext: false, blockDangerousBash: false });
    expect(out.hooks).toBeUndefined();
  });

  it("preserves user-authored hooks alongside managed ones", () => {
    const userGroup = {
      matcher: "Edit",
      hooks: [{ type: "command", command: "/usr/local/bin/format.sh" }],
    };
    const initial = { hooks: { PreToolUse: [userGroup] } };
    const out = applyManagedHooks(initial, { sessionStartGitContext: false, blockDangerousBash: true });
    expect(out.hooks?.PreToolUse).toHaveLength(2);
    expect(out.hooks?.PreToolUse?.[0]).toEqual(userGroup);
    expect(out.hooks?.PreToolUse?.[1].hooks[0].command).toContain("aiw-block-dangerous-bash");
  });

  it("replaces stale managed entries instead of duplicating", () => {
    const initial = applyManagedHooks({}, { sessionStartGitContext: true, blockDangerousBash: true });
    const out = applyManagedHooks(initial, { sessionStartGitContext: true, blockDangerousBash: true });
    expect(out.hooks?.PreToolUse).toHaveLength(1);
    expect(out.hooks?.SessionStart).toHaveLength(1);
  });

  it("leaves unrelated top-level keys untouched", () => {
    const initial = { permissions: { allow: ["WebFetch"], deny: [] } };
    const out = applyManagedHooks(initial, { sessionStartGitContext: true, blockDangerousBash: false });
    expect(out.permissions).toEqual({ allow: ["WebFetch"], deny: [] });
    expect(out.hooks?.SessionStart).toHaveLength(1);
  });

  it("does not mutate the input object", () => {
    const input = { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "/x.sh" }] }] } };
    const before = JSON.stringify(input);
    applyManagedHooks(input, { sessionStartGitContext: true, blockDangerousBash: true });
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("syncManagedHooks", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-hooks-sync-test-"));
    fs.mkdirSync(path.join(tmpRoot, "workspace"), { recursive: true });
    setWorkspaceRoot(tmpRoot);
    _resetConfig();
  });

  afterEach(() => {
    _resetConfig();
    _resetWorkspaceRoot();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates hook scripts with executable bit and writes settings.local.json", async () => {
    await syncManagedHooks();

    const blockScript = path.join(tmpRoot, ".claude", "hooks", MANAGED_SCRIPT_NAMES.blockDangerousBash);
    const sessionScript = path.join(tmpRoot, ".claude", "hooks", MANAGED_SCRIPT_NAMES.sessionStartGit);
    expect(fs.existsSync(blockScript)).toBe(true);
    expect(fs.existsSync(sessionScript)).toBe(true);
    expect(fs.statSync(blockScript).mode & 0o111).not.toBe(0);

    const settings = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".claude", "settings.local.json"), "utf-8"));
    expect(settings.hooks?.PreToolUse).toHaveLength(1);
    expect(settings.hooks?.SessionStart).toHaveLength(1);
  });

  it("preserves user hooks already present in settings.local.json", async () => {
    const settingsPath = path.join(tmpRoot, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: { allow: ["WebFetch"], deny: [] },
        hooks: {
          PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "/usr/local/bin/format.sh" }] }],
        },
      }),
    );

    await syncManagedHooks();

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.permissions).toEqual({ allow: ["WebFetch"], deny: [] });
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("/usr/local/bin/format.sh");
  });

  it("skips overwrite when settings.local.json is malformed", async () => {
    const settingsPath = path.join(tmpRoot, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, "{ not: valid json");

    await syncManagedHooks();

    expect(fs.readFileSync(settingsPath, "utf-8")).toBe("{ not: valid json");
  });
});
