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

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  env: {
    NEXT_PUBLIC_GIT_HASH: getGitHash(),
  },
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
