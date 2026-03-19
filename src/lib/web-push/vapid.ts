import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import webPush from "web-push";

const VAPID_FILE = path.join(os.homedir(), ".config", "ai-workspace", "vapid-keys.json");

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;

function loadOrCreateKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;

  try {
    const raw = fs.readFileSync(VAPID_FILE, "utf-8");
    cachedKeys = JSON.parse(raw) as VapidKeys;
    return cachedKeys;
  } catch {
    // Generate new keys
  }

  const keys = webPush.generateVAPIDKeys();
  cachedKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };

  const dir = path.dirname(VAPID_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(cachedKeys, null, 2));

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
