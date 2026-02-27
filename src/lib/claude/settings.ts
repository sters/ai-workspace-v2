import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AI_WORKSPACE_ROOT } from "../config";
import { SETTINGS_SCOPES, type SettingsScope, type SettingsFileInfo } from "@/types/claude";
export type { SettingsScope, SettingsFileInfo };

export function isValidScope(scope: string): scope is SettingsScope {
  return (SETTINGS_SCOPES as readonly string[]).includes(scope);
}

export function getSettingsFilePath(scope: SettingsScope): string {
  switch (scope) {
    case "project":
      return path.join(AI_WORKSPACE_ROOT, ".claude", "settings.json");
    case "local":
      return path.join(AI_WORKSPACE_ROOT, ".claude", "settings.local.json");
    case "user":
      return path.join(os.homedir(), ".claude", "settings.json");
  }
}

async function readSettingsFile(scope: SettingsScope): Promise<SettingsFileInfo> {
  const filePath = getSettingsFilePath(scope);
  try {
    const raw = await Bun.file(filePath).text();
    try {
      JSON.parse(raw);
    } catch {
      return { scope, filePath, exists: true, content: raw, error: "Invalid JSON" };
    }
    return { scope, filePath, exists: true, content: raw, error: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { scope, filePath, exists: false, content: null, error: null };
    }
    return { scope, filePath, exists: false, content: null, error: String(err) };
  }
}

/** Read all Claude settings files (project, local, user). */
export async function readAllSettings(): Promise<SettingsFileInfo[]> {
  return Promise.all(SETTINGS_SCOPES.map((scope) => readSettingsFile(scope)));
}

/** Write JSON content to a settings file. Throws on invalid JSON. */
export async function writeSettings(scope: SettingsScope, content: string): Promise<void> {
  JSON.parse(content); // validate
  const filePath = getSettingsFilePath(scope);
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
}
