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
- **Pipeline orchestration**: Operations (init, execute, review, create-pr, autonomous, batch, search, etc.) are sequences of `PipelinePhase`s. Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Pipeline definitions per operation type in `src/lib/pipelines/`. Max 3 concurrent operations, with automatic resume of interrupted operations on restart.
- **Claude Code execution**: Spawns Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json` (`src/lib/claude/cli.ts`). Handles `AskUserQuestion` via `--resume {session_id}`. Legacy SDK fallback is available via `AIW_CLAUDE_USE_CLI=false`.
- **SQLite persistence**: All data in `~/.config/ai-workspace/db.sqlite` via `bun:sqlite`. Events are buffered in memory and flushed every 500ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Configuration**: Three-tier config resolution (env vars > config file > defaults) in `src/lib/config/resolver.ts`, cached on `globalThis`.
- **Parsers** (`src/lib/parsers/`): Extract structured data from markdown — TODO items, README metadata, review summaries, and stream-json log entries.
- **Web Push notifications** (`src/lib/web-push/`): Browser push notifications for operation completion events.

### Client-side

- **SWR hooks** (`src/hooks/`): Auto-refreshing data fetching (10s for workspace list, 5s for detail).
- **SSE streaming** (`use-sse.ts`): Real-time operation output via `/api/events?operationId=`.
- **Operation persistence** (`use-operation.ts`): Active operation ID is stored in localStorage so navigating away and returning reconnects to the stream.

### Pages

- `/` — Dashboard listing all workspaces with search
- `/new` — New workspace creation
- `/suggestions` — Workspace suggestions
- `/workspace/[name]` — Workspace detail with tabs: Overview, TODOs, Reviews, History, Operations
- `/workspace/[name]/todo` — TODO management
- `/workspace/[name]/review/[timestamp]` — Individual review detail
- `/workspace/[name]/chat/quick` — Quick ask interface
- `/workspace/[name]/chat/interactive` — Full interactive chat with terminal
- `/workspace/[name]/operations` — Operations history
- `/workspace/[name]/history` — Git/operation history timeline
- `/utilities` — Utility hub:
  - `aiw-settings` — Application settings viewer/editor
  - `claude-auth` — Claude authentication
  - `claude-settings` — Claude settings browser (project / local / user scopes)
  - `claude-version` — Claude version info
  - `mcp-servers` — MCP server management
  - `check-update` — Update checker
  - `running` — Running operations monitor
  - `operation-prune` — Operation cleanup
  - `workspace-prune` — Workspace cleanup

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
- **Monaco Editor** (`@monaco-editor/react`) for code/config editing
- **xterm.js** (`@xterm/xterm`) for terminal UI
- **Zod** for request/runtime data validation
- **react-markdown** + **remark-gfm** for markdown rendering
- **lucide-react** for icons
- **web-push** for browser push notifications
- **Vitest** + **@testing-library/react** for testing
- **Claude Code CLI** (`claude -p --output-format stream-json`) for headless execution (legacy SDK fallback via `AIW_CLAUDE_USE_CLI=false`)
