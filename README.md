# ai-workspace-v2

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code.

Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`.

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

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, and SWR for data fetching.

### Server-side

- **Workspace state**: API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in `AI_WORKSPACE_ROOT`). Core reading logic is in `src/lib/workspace/reader.ts`.
- **Claude Code execution**: Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn` with `claude -p --output-format stream-json`. The process manager (`src/lib/process-manager.ts`) orchestrates multi-phase pipelines. Legacy SDK fallback is available via `CLAUDE_USE_CLI=false`.
- **Parsers** (`src/lib/parsers/`): Extract structured data from markdown — TODO items, README metadata, review summaries, and stream-json log entries.

### Client-side

- **SWR hooks** (`src/hooks/`): Auto-refreshing data fetching (10s for workspace list, 5s for detail).
- **SSE streaming** (`use-sse.ts`): Real-time operation output via `/api/events?operationId=`.
- **Operation persistence** (`use-operation.ts`): Active operation ID is stored in localStorage so navigating away and returning reconnects to the stream.

## Claude Settings and MCP Servers

Claude の設定ファイルと MCP サーバー構成は `AI_WORKSPACE_ROOT` に依存します。

### Settings

| Scope | Path | Description |
|-------|------|-------------|
| **project** | `${AI_WORKSPACE_ROOT}/.claude/settings.json` | プロジェクト設定（git 管理対象） |
| **local** | `${AI_WORKSPACE_ROOT}/.claude/settings.local.json` | ローカル上書き（git 管理対象外） |
| **user** | `~/.claude/settings.json` | グローバルユーザー設定 |

### MCP Servers

MCP サーバーは 2 つのソースから読み込まれます:

- **Project scope**: `${AI_WORKSPACE_ROOT}/.mcp.json`
- **Local scope**: `~/.claude.json` の `projects[absolutePath].mcpServers`（キーは `AI_WORKSPACE_ROOT` の絶対パス）

これらの設定は Web UI の Settings / MCP Servers ページから閲覧・編集できます。`AI_WORKSPACE_ROOT` が変わると参照先も変わるため、環境ごとに適切に設定してください。

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
