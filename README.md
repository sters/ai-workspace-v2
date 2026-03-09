# ai-workspace-v2.

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code.

Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`.

## Quick Start

```bash
# Run from the ai-workspace root directory
bunx github:sters/ai-workspace-v2

# Or specify the path explicitly
bunx github:sters/ai-workspace-v2 /path/to/ai-workspace

# Or use an environment variable
AI_WORKSPACE_ROOT=/path/to/ai-workspace bunx github:sters/ai-workspace-v2

# Force update to latest version (bunx users)
bunx github:sters/ai-workspace-v2 --self-update

# Development mode (hot reload)
bunx github:sters/ai-workspace-v2 --dev
```

The UI starts on **http://localhost:3741**.

## How it resolves the workspace root

`AI_WORKSPACE_ROOT` is resolved in this order:

1. CLI argument: `bunx github:sters/ai-workspace-v2 /path/to/ai-workspace`
2. Environment variable: `AI_WORKSPACE_ROOT`
3. Current working directory

The root directory must contain `workspace/` and `repositories/` subdirectories. If they don't exist, you'll be prompted to create them.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, and SWR for data fetching.

### Server-side

- **Workspace state**: API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in `AI_WORKSPACE_ROOT`). Core reading logic is in `src/lib/workspace/reader.ts`.
- **Claude Code execution**: Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json`. The pipeline manager (`src/lib/pipeline-manager.ts`) orchestrates multi-phase pipelines. Legacy SDK fallback is available via `CLAUDE_USE_CLI=false`.
- **Parsers** (`src/lib/parsers/`): Extract structured data from markdown — TODO items, README metadata, review summaries, and stream-json log entries.

### Client-side

- **SWR hooks** (`src/hooks/`): Auto-refreshing data fetching (10s for workspace list, 5s for detail).
- **SSE streaming** (`use-sse.ts`): Real-time operation output via `/api/events?operationId=`.
- **Operation persistence** (`use-operation.ts`): Active operation ID is stored in localStorage so navigating away and returning reconnects to the stream.

## Claude Settings and MCP Servers

Claude configuration files and MCP server definitions are resolved relative to `AI_WORKSPACE_ROOT`. If the root changes, the referenced paths change accordingly.

### Settings

| Scope | Path | Description |
|-------|------|-------------|
| **project** | `${AI_WORKSPACE_ROOT}/.claude/settings.json` | Project settings (tracked in git) |
| **local** | `${AI_WORKSPACE_ROOT}/.claude/settings.local.json` | Local overrides (not tracked in git) |
| **user** | `~/.claude/settings.json` | Global user settings |

### MCP Servers

MCP servers are loaded from two sources:

- **Project scope**: `${AI_WORKSPACE_ROOT}/.mcp.json`
- **Local scope**: `~/.claude.json` under `projects[absolutePath].mcpServers` (keyed by the absolute path of `AI_WORKSPACE_ROOT`)

These configurations can be viewed and edited from the Settings / MCP Servers page in the Web UI.

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

# Lint
bun run lint

# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run a single test file
bunx vitest run src/__tests__/lib/parsers/todo.test.ts
```

## Testing

Tests use **Vitest** with jsdom environment, `@testing-library/react`, and `@testing-library/jest-dom` matchers. Test files live in `src/__tests__/` mirroring the `src/` structure.

```bash
bun run test          # Run all tests
bun run test:watch    # Watch mode
bunx vitest run <file> # Single file
```

## Tech Stack

- **Next.js 16** (App Router) with React 19
- **TypeScript** (strict mode)
- **Tailwind CSS 3** with shadcn/ui-style theme
- **SWR** for data fetching
- **Vitest** + **@testing-library/react** for testing
- **Claude Code CLI** (`claude -p --output-format stream-json`) for headless execution (legacy SDK fallback via `CLAUDE_USE_CLI=false`)
