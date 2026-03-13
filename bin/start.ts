#!/usr/bin/env bun

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { INITIAL_SETTINGS_LOCAL } from "../src/lib/templates/settings";
import { checkForUpdate, GITHUB_REPO_URL } from "../src/lib/update";

const __dirname = dirname(fileURLToPath(import.meta.url));
let packageDir = resolve(__dirname, "..");
const isBunx = packageDir.includes(`${sep}node_modules${sep}`);

// Handle --self-update: clear all caches and re-run bunx to get the latest version
if (process.argv.includes("--self-update")) {
  if (!isBunx) {
    console.log("--self-update is only available when running via bunx.");
    console.log("For local development, use: git pull && bun install");
    process.exit(1);
  }

  console.log("Updating ai-workspace-v2...");

  // 1. Clear temp build caches (/tmp/ai-workspace-v2-app-*)
  const tempBase = tmpdir();
  for (const entry of readdirSync(tempBase)) {
    if (entry.startsWith("ai-workspace-v2-app-")) {
      const p = resolve(tempBase, entry);
      console.log(`  Removing build cache: ${p}`);
      rmSync(p, { recursive: true, force: true });
    }
  }

  // 2. Clear the bunx install directory (parent of node_modules containing this package)
  const bunxDir = resolve(packageDir, "..", "..");
  if (existsSync(resolve(bunxDir, "bun.lock"))) {
    console.log(`  Removing bunx cache: ${bunxDir}`);
    rmSync(bunxDir, { recursive: true, force: true });
  }

  console.log("Cache cleared. Restarting...\n");

  // Re-exec bunx without --self-update
  // Use github: specifier since this package is not published on npm
  const restArgs = process.argv.slice(2).filter((a) => a !== "--self-update");
  const child = Bun.spawn(["bunx", "github:sters/ai-workspace-v2", ...restArgs], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.exit(await child.exited ?? 0);
}

// When run via bunx, the package lives inside node_modules/ which breaks
// Next.js TypeScript compilation (SWC skips TS for node_modules files).
// Copy the project to a temp directory and install deps fresh.
let resolvedGitHash = "";
if (isBunx) {
  // Extract git hash from bunx temp bun.lock (e.g. "...#abc1234")
  try {
    const lockPath = resolve(packageDir, "..", "..", "bun.lock");
    const lock = await Bun.file(lockPath).text();
    const match = lock.match(/ai-workspace-v2#([a-f0-9]+)/);
    if (match) resolvedGitHash = match[1];
  } catch {}

  // Include git hash in cache dir name so version changes trigger rebuild
  const cacheKey = resolvedGitHash || "latest";
  const tempDir = resolve(tmpdir(), `ai-workspace-v2-app-${cacheKey}`);

  // Reuse existing temp dir if it has a valid .next build for this version
  if (existsSync(resolve(tempDir, ".next", "BUILD_ID"))) {
    console.log(`Using cached build (${cacheKey})...`);
    packageDir = tempDir;
  } else {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });

    // Copy project files (exclude node_modules and .next)
    cpSync(packageDir, tempDir, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(packageDir.length);
        return (
          !rel.startsWith(`${sep}node_modules`) &&
          !rel.startsWith(`${sep}.next`)
        );
      },
    });

    console.log("Installing dependencies...");
    Bun.spawnSync(["bun", "install"], {
      cwd: tempDir,
      stdio: ["inherit", "inherit", "inherit"],
    });

    packageDir = tempDir;
  }
}

// Check for updates when running via bunx (non-blocking with timeout)
if (isBunx && resolvedGitHash) {
  const doCheck = async () => {
    const result = await checkForUpdate(resolvedGitHash);
    if (result.updateAvailable && result.latestHash) {
      console.log(
        `\nUpdate available! (current: ${resolvedGitHash}, latest: ${result.latestHash.slice(0, 7)})\n` +
        `  Run: bunx github:sters/ai-workspace-v2 --self-update\n`
      );
    }
  };
  await Promise.race([doCheck(), Bun.sleep(3000)]);
}

// Ensure config file exists, then load config
import { getConfig, ensureConfigFile, CONFIG_FILE_PATH } from "../src/lib/app-config";
if (ensureConfigFile()) {
  console.log(`Created config: ${CONFIG_FILE_PATH}`);
}
const appConfig = getConfig();

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let root = args[0] || process.env.AI_WORKSPACE_ROOT || appConfig.workspaceRoot || process.cwd();
root = resolve(root);

const workspaceDir = resolve(root, "workspace");
const repositoriesDir = resolve(root, "repositories");

const missingDirs: string[] = [];
if (!existsSync(workspaceDir)) missingDirs.push(workspaceDir);
if (!existsSync(repositoriesDir)) missingDirs.push(repositoriesDir);

if (missingDirs.length > 0) {
  console.log(`The following directories do not exist under ${root}:`);
  for (const dir of missingDirs) {
    console.log(`  - ${dir}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Create them? [y/N] ", resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(1);
  }

  for (const dir of missingDirs) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created: ${dir}`);
  }

  // Create initial .claude/settings.local.json if it doesn't exist
  const settingsLocalPath = resolve(root, ".claude", "settings.local.json");
  if (!existsSync(settingsLocalPath)) {
    mkdirSync(resolve(root, ".claude"), { recursive: true });
    writeFileSync(settingsLocalPath, JSON.stringify(INITIAL_SETTINGS_LOCAL, null, 2) + "\n");
    console.log(`Created: ${settingsLocalPath}`);
  }
}

const port = appConfig.server.port;
const chatPort = appConfig.server.chatPort;

console.log(`ai-workspace root: ${root}`);
console.log(`Starting on http://localhost:${port}`);

const isDev = process.argv.includes("--dev");
const isHot = process.argv.includes("--hot");

const sharedEnv = {
  ...process.env,
  AI_WORKSPACE_ROOT: root,
  PORT: String(port),
  CHAT_WS_PORT: String(chatPort),
  ...(resolvedGitHash ? { NEXT_PUBLIC_GIT_HASH: resolvedGitHash } : {}),
};

// Start Next.js server
const nextFlags = isHot ? ["--hot"] : isDev ? ["--dev"] : [];
const nextServer = Bun.spawn(["bun", "--bun", "run", "bin/next-server.ts", ...nextFlags], {
  cwd: packageDir,
  stdio: ["inherit", "inherit", "inherit"],
  env: sharedEnv,
});

// Start WebSocket chat server
const chatServer = Bun.spawn(["bun", "--bun", "run", "bin/chat-server.ts"], {
  cwd: packageDir,
  stdio: ["inherit", "inherit", "inherit"],
  env: sharedEnv,
});

function killAll() {
  nextServer.kill();
  chatServer.kill();
}

process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);

// Wait for Next.js to exit, then clean up chat server
const nextExitCode = await nextServer.exited;
chatServer.kill();

// Next.js dev server queries terminal capabilities (background color, cursor
// position, device attributes). When the process is killed, the terminal's
// responses arrive on stdin with no process to consume them, so the shell
// displays them as garbage text. Drain any pending responses before exiting.
if (process.stdin.isTTY) {
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("readable", () => {
      // discard whatever is buffered
      while (process.stdin.read() !== null) {}
    });
    await Bun.sleep(100);
    process.stdin.pause();
    process.stdin.setRawMode(false);
  } catch {
    // setRawMode can fail if stdin fd is already closed (e.g. bunx environment)
  }
}

process.exit(nextExitCode ?? 0);
