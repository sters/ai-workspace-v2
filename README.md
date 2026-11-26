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
3. Current working directory

The root directory must contain `workspace/` and `repositories/` subdirectories. If they don't exist, you'll be prompted to create them.

## Per-workspace data isolation

Config and database are stored per-workspace under `{workspaceRoot}/.ai-workspace/`:

```
/path/to/ai-workspace/
  .ai-workspace/
    config.yml                # per-workspace config
    db.sqlite                 # per-workspace database
```

This ensures each workspace has isolated settings and operation history.

## Configuration

Three-tier config system (priority: env vars > config file > defaults):

- **Config file**: `{workspaceRoot}/.ai-workspace/config.yml` (auto-created on first run)

**Environment variables** (all optional, override config file values):

| Variable | Default | Description |
|----------|---------|-------------|
| `AIW_WORKSPACE_ROOT` | cwd | ai-workspace root directory |
| `AIW_PORT` | 3741 | Web server port |
| `AIW_CHAT_PORT` | 3742 | WebSocket chat server port |
| `AIW_CLAUDE_PATH` | auto-detect | Custom Claude CLI path |
| `AIW_DISABLE_ACCESS_LOG` | `false` | Silence the web server's API access log (also `server.disableAccessLog` in `config.yml`) |

The "Open in..." menu is configured via the `openers` field in `config.yml`:

```yaml
openers:
  - name: Editor (VSCode)
    command: code {path}
  - name: Terminal
    command: open -a Terminal {path}
  - name: Cursor
    command: cursor {path}
```

Legacy `editor:` and `terminal:` keys are auto-migrated into `openers` at runtime; you can keep them or replace them with the block above.

### Auto-managed Claude Code hooks

On every startup, ai-workspace syncs a small set of managed hooks into `${AIW_WORKSPACE_ROOT}/.claude/settings.local.json` and writes the corresponding scripts under `.claude/hooks/aiw-*.sh`. Managed entries are identified by the `aiw-` command prefix; any user-authored hooks without that prefix are preserved as-is. Toggle each one in `config.yml`:

```yaml
hooks:
  sessionStartGitContext: true   # SessionStart: inject `git branch` + `git status --short` as additionalContext
  blockDangerousBash: true       # PreToolUse(Bash): block `rm -rf /...`, `git push --force` (without --force-with-lease), `git reset --hard`
```

### Other config options

```yaml
suggest:
  enabled: true   # set false to disable the post-operation workspace-suggestion background job
```

## Architecture

**React 19** with TanStack Router, served and bundled by `Bun.serve` (HTML import), TypeScript strict mode, Tailwind CSS 4, and SWR for data fetching.

### Server-side

- **Workspace state**: API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in `AIW_WORKSPACE_ROOT`). Core reading logic is in `src/lib/workspace/reader.ts`.
- **Pipeline orchestration**: Operations (init, execute, review, create-pr, autonomous, batch, search, etc.) are sequences of `PipelinePhase`s. Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Pipeline definitions per operation type in `src/lib/pipelines/`. Max 3 concurrent operations. Operations interrupted by a server shutdown are settled as failed on restart rather than resumed.
- **Claude Code execution**: Spawns Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json` (`src/lib/claude/cli.ts`). Handles `AskUserQuestion` via `--resume {session_id}`.
- **SQLite persistence**: Per-workspace database in `{workspaceRoot}/.ai-workspace/db.sqlite` via `bun:sqlite`. Events are buffered in memory and flushed every 5000ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Configuration**: Per-workspace config resolution (env vars > config file > defaults) in `src/lib/config/resolver.ts`, cached on `globalThis`. Workspace root determines the config directory via `src/lib/config/workspace-dir.ts`.
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
- `/operations` — Running operations and the 50 most recent finished ones, across workspaces
- `/operations/[id]` — One operation; redirects to its workspace's Operations tab when it belongs to one
- `/scheduled-jobs` — Cron-scheduled instructions and commands
- `/repo-lessons` — Lessons distilled from finished workspaces
- `/run-costs` — Claude spend by operation, phase, step, model and effort
- `/notification-logs` — Web push history
- `/settings/aiw` — `.ai-workspace/config.yml` editor
- `/settings/snippet/init` — Snippets for workspace descriptions
- `/settings/snippet/chat` — Saved chat start prompts
- `/settings/claude/auth` — Claude authentication
- `/settings/claude/settings` — Claude settings browser (project / local / user scopes)
- `/settings/claude/mcp-servers` — MCP server management
- `/settings/claude/version` — Claude version info
- `/settings/claude/usage` — Claude billing period usage
- `/cleanup/workspace`, `/cleanup/operation-log`, `/cleanup/repository` — Cleanups
- `/check-update` — Update checker

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

## MCP Server

The web server also serves MCP itself, over Streamable HTTP at `/api/mcp`, so another Claude Code session (or any MCP client) can drive ai-workspace while the server is running:

```bash
claude mcp add --transport http ai-workspace http://localhost:3741/api/mcp
```

Tools: `list_workspaces`, `get_workspace`, `archive_workspace`, `autonomous`, `init_only`, `update_todo`, `execute`, `review`, `create_pr`, `list_operations`, `get_operation`, `answer_question`, `kill_operation`. `autonomous` with only a `description` matches the web UI's Start autonomous (init, then the execute / review loop, then PRs); `init_only` matches Init only. Tools that start an operation return its id at once; poll `get_operation` until it is no longer `running`, and answer its `pendingQuestion` with `answer_question` when it asks one. Requests carrying a non-local `Origin` are refused; there is no other authentication, so the endpoint has the same exposure as the rest of the local API.

## Development

```bash
# Install dependencies
bun install

# Development with hot reload
bun run dev:hot

# Start (the page is bundled on startup; there is no separate build step)
bun run start

# Lint (runs tsc --noEmit + eslint)
bun run lint

# Run all tests
bun run test

# Run a single test file (components/ and hooks/ also need --preload ./src/test-setup-dom.ts)
bun test src/__tests__/lib/parsers/todo.test.ts
```

## Testing

Tests use **`bun test`** with `@testing-library/react` and `@testing-library/jest-dom` matchers; `src/__tests__/components/` and `src/__tests__/hooks/` run with a happy-dom DOM. Test files live in `src/__tests__/` mirroring the `src/` structure.

```bash
bun run test          # Run all tests (test:node, then test:dom)
bun test <file>       # Single non-DOM file
bun test --preload ./src/test-setup-dom.ts <file>  # Single components/ or hooks/ file
```

## Tech Stack

- **React 19** with **TanStack Router**, on `Bun.serve`
- **TypeScript** (strict mode)
- **Tailwind CSS 4** with shadcn/ui-style theme
- **SWR** for data fetching
- **Monaco Editor** (`@monaco-editor/react`) for code/config editing
- **xterm.js** (`@xterm/xterm`) for terminal UI
- **Zod** for request/runtime data validation
- **react-markdown** + **remark-gfm** for markdown rendering
- **lucide-react** for icons
- **web-push** for browser push notifications
- **Vitest** + **@testing-library/react** for testing
- **Claude Code CLI** (`claude -p --output-format stream-json`) for headless execution
