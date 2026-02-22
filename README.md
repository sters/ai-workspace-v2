# ai-workspace-v2

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code.

Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) via the `@anthropic-ai/claude-agent-sdk`.

## Quick Start

```bash
# Run from the ai-workspace root directory
bunx ai-workspace-v2

# Or specify the path explicitly
bunx ai-workspace-v2 /path/to/ai-workspace

# Or use an environment variable
AI_WORKSPACE_ROOT=/path/to/ai-workspace bunx ai-workspace-v2

# Development mode (hot reload)
bunx ai-workspace-v2 --dev
```

The UI starts on **http://localhost:3741**.

## How it resolves the workspace root

`AI_WORKSPACE_ROOT` is resolved in this order:

1. CLI argument: `bunx ai-workspace-v2 /path/to/ai-workspace`
2. Environment variable: `AI_WORKSPACE_ROOT`
3. Current working directory

The root directory must contain `workspace/` and `repositories/` subdirectories. If they don't exist, you'll be prompted to create them.

## Development

```bash
# Install dependencies
bun install

# Development with hot reload
bun run dev:hot

# Production build + start
bun run build && bun run start

# Type checking
bunx tsc --noEmit
```

## Tech Stack

- **Next.js 15** (App Router) with React 19
- **TypeScript** (strict mode)
- **Tailwind CSS 3** with shadcn/ui-style theme
- **SWR** for data fetching
- **@anthropic-ai/claude-agent-sdk** for running Claude Code headlessly
