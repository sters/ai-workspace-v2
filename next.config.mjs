import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function getGitHash() {
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
