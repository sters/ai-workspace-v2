import path from "node:path";
import fs from "node:fs";
import webPush from "web-push";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";
import { getResolvedWorkspaceRoot } from "@/lib/config/resolver";

function getVapidFilePath(): string {
  return path.join(getWorkspaceConfigDir(getResolvedWorkspaceRoot()), "vapid-keys.json");
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;

function loadOrCreateKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;

  const vapidFile = getVapidFilePath();

  try {
    const raw = fs.readFileSync(vapidFile, "utf-8");
    cachedKeys = JSON.parse(raw) as VapidKeys;
    return cachedKeys;
  } catch {
    // Generate new keys
  }

  const keys = webPush.generateVAPIDKeys();
  cachedKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };

  const dir = path.dirname(vapidFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(vapidFile, JSON.stringify(cachedKeys, null, 2));

  return cachedKeys;
}

export function getVapidPublicKey(): string {
  return loadOrCreateKeys().publicKey;
}

export function getVapidDetails(): { subject: string; publicKey: string; privateKey: string } {
  const keys = loadOrCreateKeys();
  return {
    subject: "mailto:ai-workspace@localhost",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
}
