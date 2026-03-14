# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code. Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json` (with SDK fallback via `AIW_CLAUDE_USE_CLI=false`). A separate WebSocket chat server runs on port 3742 for interactive Claude sessions.

## Commands

```bash
# Run via bunx (from ai-workspace root, or specify path)
bunx github:sters/ai-workspace-v2 [/path/to/ai-workspace]

# Install dependencies
bun install

# Development with hot reload
bun run dev:hot

# Production build + start
bun run build && bun run start

# Lint (runs both tsc --noEmit AND eslint src/ — no need to run tsc separately)
bun run lint

# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run a single test file
bunx vitest run src/__tests__/lib/parsers/todo.test.ts
```

The app runs on port 3741 (Next.js) and 3742 (WebSocket chat). Set `AIW_WORKSPACE_ROOT` env var to point to the ai-workspace root directory (containing `workspace/` and `repositories/`). When running via `bunx`, it can also be passed as a CLI argument or defaults to the current working directory.

## Configuration

Three-tier config system (priority: env vars > config file > defaults):

- **Config file**: `~/.config/ai-workspace/config.yml` (auto-created on first run)
- **Config resolution**: `src/lib/app-config.ts` — merges defaults, YAML config, and env overrides. Cached on `globalThis` to survive Next.js module isolation.

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

### Server-side: Reading workspace state from disk

API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in ai-workspace root):

- **`src/lib/workspace/reader.ts`** — Core functions that scan `WORKSPACE_DIR` to list workspaces, read README.md, TODO files, review artifacts, and git history. All filesystem access happens here.
- **`src/lib/app-config.ts`** — Three-tier config resolution (env > `~/.config/ai-workspace/config.yml` > defaults). Exports `getConfig()` cached on `globalThis`.
- **`src/lib/config.ts`** — Resolves `AI_WORKSPACE_ROOT` constant (from `AIW_WORKSPACE_ROOT` env, config file, or `..` fallback) and `WORKSPACE_DIR` paths.
- **`src/lib/parsers/`** — Extract structured data from markdown files using regex:
  - `todo.ts` — TODO items use checkbox syntax: `[x]` completed, `[ ]` pending, `[!]` blocked, `[~]` in-progress.
  - `readme.ts` — Parse workspace metadata from README.md.
  - `review.ts` — Parse review session summaries.
  - `stream.ts` — Converts raw `stream-json` messages (from CLI or SDK) into typed `LogEntry` objects for rendering.

### Server-side: Running Claude Code operations

Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn`:

- **`src/lib/claude/`** — Claude CLI/SDK execution and authentication. Facade in `index.ts` delegates to CLI (default) or SDK (`AIW_CLAUDE_USE_CLI=false`). CLI mode (`cli.ts`) spawns `claude -p --output-format stream-json` and handles `AskUserQuestion` via `--resume {session_id}`. Also includes auth, version, MCP server discovery, and settings management (three scopes: project/local/user).
- **`src/lib/pipeline-manager.ts`** — Pipeline orchestration engine. Each operation is a sequence of `PipelinePhase`s (single child, parallel group, or TypeScript function). Function phases get a rich context (`ctx`) with helpers: `emitStatus`, `emitResult`, `emitAsk` (prompt user and await answer), `runChild`, `runChildGroup`, `setWorkspace`. Max 3 concurrent operations (configurable); phase timeouts default to 20min (Claude) / 3min (functions).
- **`src/lib/pipelines/`** — Pipeline definitions for each operation type. Each file exports a `build*Pipeline()` function returning a sequence of phases. Shared reusable actions live in `actions/`.
- **`src/lib/operation-store.ts`** — File-based operation persistence. Stores operation events as JSONL files in `.operations/` directory.
- **`src/lib/schemas.ts`** — Zod validation schemas for all HTTP request bodies (POST endpoints).
- **`src/lib/runtime-schemas.ts`** — Zod schemas for validating untrusted runtime data: JSONL files from disk, WebSocket messages, localStorage data, SSE events, and Claude CLI stream fragments. Separate from `schemas.ts` by design.
- **`src/lib/validate.ts`** — `parseBody()` helper for API routes. Returns discriminated union: `{success: true, data}` or `{success: false, response: NextResponse}`. Also validates workspace names and operation IDs with regex (path traversal protection).
- **`src/lib/workspace/`** — TypeScript equivalents of shell scripts (setup, git operations, PR helpers, template I/O). All paths relative to `AI_WORKSPACE_ROOT`.
- **`src/lib/templates/`** — All template strings and prompt builders. `prompts/` contains `build*Prompt(input)` functions for each agent type (planner, executor, reviewer, pr-creator, etc.).
- **`src/app/api/events/route.ts`** — SSE endpoint. Clients connect with `?operationId=` to stream `OperationEvent`s in real time. Replays existing events on connection, then streams new ones.

### Client-side

- **`src/hooks/`** — SWR hooks with auto-refresh (`use-workspaces.ts`, `use-workspace.ts`), operation lifecycle with localStorage persistence (`use-operation.ts`), and SSE streaming (`use-sse.ts`).
- **Components** in `src/components/`: `dashboard/` (workspace list/cards), `workspace/` (detail views), `operation/` (execution UI with log rendering and ask-input), `shared/` (generic UI primitives).

### Pages

- `/` — Dashboard listing all workspaces
- `/workspace/[name]` — Workspace detail with tabs: Overview, TODOs, Reviews, History, Operations
- `/workspace/[name]/chat` — Chat interface for workspace
- `/workspace/[name]/todo` — TODO management
- `/utilities` — Utility hub: claude-auth, claude-version, claude-settings (project/user/local), mcp-servers, running operations, workspace-prune

### API Routes

API routes live under `src/app/api/`. Key patterns:
- `GET /api/workspaces/[name]/{readme,todos,reviews,history}` — Read workspace state from disk
- `POST /api/operations/{init,execute,review,create-pr,update-todo,create-todo,delete,batch,mcp-auth}` — Start operations
- `POST /api/operations/{answer,kill}` — Control running operations
- `GET /api/events?operationId=` — SSE stream for operation output
- `GET /api/{claude-auth,claude-version,claude-settings,mcp-servers}` — Claude CLI utilities

## Styling

Uses Tailwind with a shadcn/ui-style CSS variable theme system (`hsl(var(--primary))`, etc.) defined in `globals.css`. The `cn()` utility from `src/lib/utils.ts` merges Tailwind classes via `clsx` + `tailwind-merge`. Dark mode is configured via the `class` strategy but not currently toggled.

## Development Rules

- **TDD (Test-Driven Development)**: Write or update tests before implementing production code. When adding a new feature or fixing a bug, first write a failing test that defines the expected behavior, then implement the code to make it pass.
- **Pre-commit checks**: Always run `bun run lint` and `bun run test` before creating a git commit. Both must pass with zero errors.
- **Git commands**: Run `git add`, `git commit`, and `git push` as separate commands — never chain them into a single line. Do not use subcommand substitution `$()` in git commands (e.g., avoid `git commit -m "$(cat <<'EOF' ... EOF)"`).

## Conventions

- Path alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`).
- Types live in `src/types/` — `operation.ts` (Operation, OperationEvent, OperationType, OperationPhaseInfo), `workspace.ts` (TodoItem, TodoFile, WorkspaceMeta, WorkspaceSummary, WorkspaceDetail, ReviewSession, HistoryEntry), `claude.ts` (ClaudeProcess, RunClaudeOptions, LogEntry types), `pipeline.ts` (PipelinePhase, PhaseFunctionContext), `prompts.ts` (prompt input interfaces), `pty.ts` (DataListener).
- `bin/start.ts` is the CLI entry point. Resolves workspace root from CLI args / `AIW_WORKSPACE_ROOT` env / config file / cwd, validates workspace directory exists, auto-creates `workspace/` and `repositories/` if missing, then spawns both the Next.js server and WebSocket chat server. Supports `--self-update` flag for bunx users. Additional entry points: `bin/chat-server.ts` (WebSocket chat on port 3742), `bin/next-server.ts` (Next.js on port 3741).
- **`globalThis` pattern**: Mutable state (pipeline operations, app config cache, chat sessions) is stored on `globalThis` to survive Next.js Hot Module Reloading during development. Tests must account for this (see `test-setup.ts`).
- **`force-dynamic`**: All API routes export `const dynamic = "force-dynamic"` since they read from the filesystem.
- `NEXT_PUBLIC_GIT_HASH` is injected at build time by `next.config.ts` for display in the sidebar.
- ESLint uses flat config (`eslint.config.ts`) with typescript-eslint. Unused vars must be prefixed with `_` (both args and vars). ESLint ignores `bin/**` — entry point files there are not linted.

## Testing

Tests use **Vitest** with jsdom environment, `@testing-library/react`, and `@testing-library/jest-dom` matchers. Test files live in `src/__tests__/` mirroring the `src/` structure (e.g., `src/__tests__/lib/parsers/todo.test.ts`). Vitest globals are enabled (no need to import `describe`/`it`/`expect`). Note: `tsconfig.json` excludes `src/__tests__/` and `src/test-setup.ts`, so `tsc --noEmit` (via `bun run lint`) does not type-check test files — Vitest handles that separately.

## Key Dependencies

- `@anthropic-ai/claude-agent-sdk` — Legacy SDK for running Claude Code headlessly (used when `CLAUDE_USE_CLI=false`); marked as `serverExternalPackages` in next.config.ts
- `swr` — Client-side data fetching with automatic revalidation
- `react-markdown` + `remark-gfm` — Markdown rendering
- `lucide-react` — Icons
