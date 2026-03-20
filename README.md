# ai-workspace-v2

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager and task executor for Claude Code.

Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, autonomous, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`. A separate WebSocket chat server runs on port 3742 for interactive Claude sessions.

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
- **Claude Code execution**: Operations spawn Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json`. The pipeline manager (`src/lib/pipeline-manager.ts`) orchestrates multi-phase pipelines with configurable concurrency and timeouts. Legacy SDK fallback is available via `AIW_CLAUDE_USE_CLI=false`.
- **Autonomous mode**: The autonomous pipeline (`src/lib/pipelines/autonomous.ts`) runs an Execute → Review → Gate loop. An AI-powered gate evaluates review results and decides whether to loop (fix issues) or stop.
- **Batch operations**: The batch pipeline (`src/lib/pipelines/batch.ts`) runs multiple operations in sequence or with best-of-n evaluation.
- **Best-of-N evaluation**: The best-of-n pipeline (`src/lib/pipelines/best-of-n.ts`) runs N candidate executions in parallel using sub-worktrees, then uses an AI reviewer to select or synthesize the best result. Used by batch operations for higher-quality outputs.
- **Quick ask**: The quick-ask pipeline (`src/lib/templates/prompts/quick-ask.ts`, `src/app/api/operations/quick-ask/route.ts`) provides a one-shot Q&A interface for asking questions about a workspace. It reads workspace context (README, TODOs) and answers concisely without running multi-phase operations.
- **Parsers** (`src/lib/parsers/`): Extract structured data from markdown — TODO items, README metadata, review summaries, and stream-json log entries.
- **Web Push** (`src/lib/web-push/`): Browser push notifications for `AskUserQuestion` events when Claude needs user input.

### Client-side

- **SWR hooks** (`src/hooks/`): Auto-refreshing data fetching (10s for workspace list, 5s for detail).
- **SSE streaming** (`use-sse.ts`): Real-time operation output via `/api/events?operationId=`.
- **Operation persistence** (`use-operation.ts`): Active operation ID is stored in localStorage so navigating away and returning reconnects to the stream.
- **Monaco editor**: Integrated code editor for viewing and editing Claude settings and MCP server configs.
- **Xterm.js**: Terminal emulator for interactive chat sessions.

### Pages

- `/` — Dashboard listing all workspaces
- `/new` — Create a new workspace (init operation)
- `/workspace/[name]` — Workspace detail (overview)
- `/workspace/[name]/todo` — TODO management
- `/workspace/[name]/review` — Review reports
- `/workspace/[name]/history` — Git history
- `/workspace/[name]/operations` — Operation logs
- `/workspace/[name]/chat` — Interactive chat interface
- `/utilities` — Utility hub: aiw-settings, check-update, claude-auth, claude-version, claude-settings (project/local/user), mcp-servers, running operations, operation-prune, workspace-prune

### API Routes

- `GET /api/workspaces/[name]/{readme,todos,reviews,history}` — Read workspace state from disk
- `POST /api/operations/{init,execute,review,create-pr,update-todo,create-todo,delete}` — Start operations
- `POST /api/operations/{autonomous,batch,search,quick-ask}` — Advanced operations
- `POST /api/operations/{claude-login,mcp-auth,workspace-prune,operation-prune,clear}` — Maintenance operations
- `POST /api/operations/{answer,kill}` — Control running operations
- `POST /api/operations/{open-editor,open-terminal}` — Open local tools
- `GET /api/events?operationId=` — SSE stream for operation output
- `GET /api/{claude-auth,claude-version,claude-settings,mcp-servers,aiw-settings}` — Configuration endpoints
- `GET /api/{search,chat-sessions,check-update,push,subagent-output}` — Utility endpoints

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
```

See [Testing](#testing) for test commands.

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
- **Monaco Editor** for config editing
- **Xterm.js** for terminal emulation
- **Zod** for request/response validation
- **Vitest** + **@testing-library/react** for testing
- **Web Push** for browser notifications
- **Claude Code CLI** (`claude -p --output-format stream-json`) for headless execution (legacy SDK fallback via `AIW_CLAUDE_USE_CLI=false`)
