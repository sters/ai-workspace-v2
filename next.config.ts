import type { NextConfig } from "next";

function getGitHash(): string {
  // When run via bunx, bin/start.ts sets this from bun.lock
  if (process.env.NEXT_PUBLIC_GIT_HASH) {
    return process.env.NEXT_PUBLIC_GIT_HASH;
  }
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
    return result.stdout.toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const disableAccessLog =
  process.env.AIW_DISABLE_ACCESS_LOG === "true" ||
  process.env.AIW_DISABLE_ACCESS_LOG === "1";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "bun:sqlite"],
  env: {
    NEXT_PUBLIC_GIT_HASH: getGitHash(),
  },
  ...(disableAccessLog ? { logging: { incomingRequests: false } } : {}),
  async redirects() {
    return [
      {
        source: "/utilities/claude-settings",
        destination: "/utilities/claude-settings/project",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
