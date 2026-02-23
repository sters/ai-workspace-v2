import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function getGitHash() {
  // When run via bunx, bin/start.mjs sets this from bun.lock
  if (process.env.NEXT_PUBLIC_GIT_HASH) {
    return process.env.NEXT_PUBLIC_GIT_HASH;
  }
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  env: {
    NEXT_PUBLIC_GIT_HASH: getGitHash(),
  },
  webpack: (config) => {
    config.resolve.alias["@"] = resolve(projectRoot, "src");
    return config;
  },
};

export default nextConfig;
