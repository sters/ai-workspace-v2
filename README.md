# ai-workspace-v2

Web UI dashboard for a multi-repository workspace manager and task executer for Claude Code.

Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`. A separate WebSocket chat server runs on port 3742 for interactive Claude sessions.

**This tool is under development through real usecases. The latest version breaks easily.**

## Quick Start

```bash
# Run from the ai-workspace root directory
bunx github:sters/ai-workspace-v2

# Or specify the path explicitly
bunx github:sters/ai-workspace-v2 /path/to/ai-workspace

# Or use an environment variable
AIW_WORKSPACE_ROOT=/path/to/ai-workspace bunx github:sters/ai-workspace-v2

# Force update to latest version (bunx users)
bunx github:sters/ai-workspace-v2 --self-update

# Development mode (hot reload)
bunx github:sters/ai-workspace-v2 --dev
```

The UI starts on **http://localhost:3741**, chat server on **http://localhost:3742**.

## How it resolves the workspace root

`AIW_WORKSPACE_ROOT` is resolved in this order:

1. CLI argument: `bunx github:sters/ai-workspace-v2 /path/to/ai-workspace`
2. Environment variable: `AIW_WORKSPACE_ROOT`
3. Config file: `~/.config/ai-workspace/config.yml`
4. Current working directory

The root directory must contain `workspace/` and `repositories/` subdirectories. If they don't exist, you'll be prompted to create them.

## Configuration

Three-tier config system (priority: env vars > config file > defaults):

- **Config file**: `~/.config/ai-workspace/config.yml` (auto-created on first run)

**Environment variables** (all optional, override config file values):

| Variable | Default | Description |
|----------|---------|-------------|
| `AIW_WORKSPACE_ROOT` | cwd | ai-workspace root directory |
| `AIW_PORT` | 3741 | Next.js server port |
| `AIW_CHAT_PORT` | 3742 | WebSocket chat server port |
| `AIW_CLAUDE_PATH` | auto-detect | Custom Claude CLI path |
| `AIW_CLAUDE_USE_CLI` | `true` | Use CLI (`true`) or legacy SDK (`false`) |
| `AIW_EDITOR` | `code {path}` | Editor command template |
| `AIW_TERMINAL` | `open -a Terminal {path}` | Terminal command template |

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, and SWR for data fetching.

### Server-side

- **Workspace state**: API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in `AIW_WORKSPACE_ROOT`). Core reading logic is in `src/lib/workspace/reader.ts`.
- **Claude Code execution**: Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json`. The pipeline manager (`src/lib/pipeline-manager.ts`) orchestrates multi-phase pipelines. Legacy SDK fallback is available via `AIW_CLAUDE_USE_CLI=false`.
- **Parsers** (`src/lib/parsers/`): Extract structured data from markdown — TODO items, README metadata, review summaries, and stream-json log entries.

### Client-side

- **SWR hooks** (`src/hooks/`): Auto-refreshing data fetching (10s for workspace list, 5s for detail).
- **SSE streaming** (`use-sse.ts`): Real-time operation output via `/api/events?operationId=`.
- **Operation persistence** (`use-operation.ts`): Active operation ID is stored in localStorage so navigating away and returning reconnects to the stream.

### Pages

- `/` — Dashboard listing all workspaces
- `/new` — Create a new workspace
- `/workspace/[name]` — Workspace detail (overview)
- `/workspace/[name]/todo` — TODO management
- `/workspace/[name]/review` — Review session list
- `/workspace/[name]/review/[timestamp]` — Review session detail
- `/workspace/[name]/history` — Git history
- `/workspace/[name]/operations` — Operation log
- `/workspace/[name]/chat/interactive` — Interactive chat (WebSocket-based)
- `/workspace/[name]/chat/quick` — Quick one-shot chat
- `/utilities` — Utility hub
- `/utilities/aiw-settings` — AI Workspace configuration
- `/utilities/claude-auth` — Claude authentication
- `/utilities/claude-version` — Claude CLI version info
- `/utilities/claude-settings/{project,local,user}` — Claude settings by scope
- `/utilities/mcp-servers` — MCP server management
- `/utilities/running` — Running operations
- `/utilities/operation-prune` — Prune old operations
- `/utilities/workspace-prune` — Prune old workspaces
- `/utilities/check-update` — Check for updates

## Web Push Notifications

Supports browser push notifications for operation events (e.g., when an `AskUserQuestion` event requires user input). Uses the Web Push protocol with VAPID keys auto-generated on first run. Subscribe/unsubscribe via the UI; notifications are delivered even when the browser tab is in the background.

## Claude Settings and MCP Servers

Claude configuration files and MCP server definitions are resolved relative to `AIW_WORKSPACE_ROOT`. If the root changes, the referenced paths change accordingly.

### Settings

| Scope | Path | Description |
|-------|------|-------------|
| **project** | `${AIW_WORKSPACE_ROOT}/.claude/settings.json` | Project settings (tracked in git) |
| **local** | `${AIW_WORKSPACE_ROOT}/.claude/settings.local.json` | Local overrides (not tracked in git) |
| **user** | `~/.claude/settings.json` | Global user settings |

### MCP Servers

MCP servers are loaded from two sources:

- **Project scope**: `${AIW_WORKSPACE_ROOT}/.mcp.json`
- **Local scope**: `~/.claude.json` under `projects[absolutePath].mcpServers` (keyed by the absolute path of `AIW_WORKSPACE_ROOT`)

These configurations can be viewed and edited from the Settings / MCP Servers page in the Web UI.

## Development

```bash
# Install dependencies
bun install

# Development with hot reload
bun run dev:hot

# Production build + start
bun run build && bun run start

# Lint (runs tsc --noEmit + eslint)
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
- **Zod** for request/response validation
- **Web Push** for browser notifications
- **xterm.js** for terminal emulation (MCP auth, interactive sessions)
- **Monaco Editor** for code editing
- **Vitest** + **@testing-library/react** for testing
- **Claude Code CLI** (`claude -p --output-format stream-json`) for headless execution (legacy SDK fallback via `AIW_CLAUDE_USE_CLI=false`)
