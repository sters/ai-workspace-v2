#!/usr/bin/env node

import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
let packageDir = resolve(__dirname, "..");

// When run via bunx, the package lives inside node_modules/ which breaks
// Next.js TypeScript compilation (SWC skips TS for node_modules files).
// Copy the project to a temp directory and install deps fresh.
let resolvedGitHash = "";
if (packageDir.includes(`${sep}node_modules${sep}`)) {
  // Extract git hash from bunx temp bun.lock (e.g. "...#abc1234")
  try {
    const lockPath = resolve(packageDir, "..", "..", "bun.lock");
    const lock = readFileSync(lockPath, "utf-8");
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
    execFileSync("bun", ["install"], {
      cwd: tempDir,
      stdio: "inherit",
    });

    packageDir = tempDir;
  }
}

// Resolve AI_WORKSPACE_ROOT: args > env > cwd
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let root = args[0] || process.env.AI_WORKSPACE_ROOT || process.cwd();
root = resolve(root);

const workspaceDir = resolve(root, "workspace");
const repositoriesDir = resolve(root, "repositories");

const missingDirs = [];
if (!existsSync(workspaceDir)) missingDirs.push(workspaceDir);
if (!existsSync(repositoriesDir)) missingDirs.push(repositoriesDir);

if (missingDirs.length > 0) {
  console.log(`The following directories do not exist under ${root}:`);
  for (const dir of missingDirs) {
    console.log(`  - ${dir}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
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
}

console.log(`ai-workspace root: ${root}`);
console.log(`Starting on http://localhost:3741`);

const isDev = process.argv.includes("--dev");
const cmd = isDev ? "dev" : "start";

// For production mode, build first if needed
if (!isDev && !existsSync(resolve(packageDir, ".next"))) {
  console.log("Building...");
  execFileSync("bun", ["run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(resolvedGitHash ? { NEXT_PUBLIC_GIT_HASH: resolvedGitHash } : {}),
    },
  });
}

const child = spawn("bun", ["run", cmd], {
  cwd: packageDir,
  stdio: "inherit",
  env: {
    ...process.env,
    AI_WORKSPACE_ROOT: root,
    PORT: "3741",
    ...(resolvedGitHash ? { NEXT_PUBLIC_GIT_HASH: resolvedGitHash } : {}),
  },
});

process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
