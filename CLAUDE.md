# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code. Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json` (with SDK fallback via `CLAUDE_USE_CLI=false`).

## Commands

```bash
# Run via bunx (from ai-workspace root, or specify path)
bunx ai-workspace-v2 [/path/to/ai-workspace]

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
bunx vitest run src/__tests__/lib/todo-parser.test.ts
```

The app runs on port 3741. Set `AI_WORKSPACE_ROOT` env var to point to the ai-workspace root directory (containing `workspace/` and `repositories/`). When running via `bunx`, it can also be passed as a CLI argument or defaults to the current working directory.

## Architecture

**Next.js 15 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, and SWR for data fetching.

### Server-side: Reading workspace state from disk

API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in ai-workspace root):

- **`src/lib/workspace.ts`** — Core functions that scan `WORKSPACE_DIR` to list workspaces, read README.md, TODO files, review artifacts, and git history. All filesystem access happens here.
- **`src/lib/config.ts`** — Resolves `AI_WORKSPACE_ROOT` (from env or `..` fallback) and `WORKSPACE_DIR` paths.
- **Parsers** (`src/lib/todo-parser.ts`, `readme-parser.ts`, `review-parser.ts`) — Extract structured data from markdown files using regex. TODO items use checkbox syntax: `[x]` completed, `[ ]` pending, `[!]` blocked, `[~]` in-progress.

### Server-side: Running Claude Code operations

Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn`:

- **`src/lib/claude-cli.ts`** — Spawns `claude -p` with `--output-format stream-json` via `Bun.spawn`. Streams events in the same format as the SDK. Handles `AskUserQuestion` by detecting permission denials and using `--resume {session_id}` to inject answers and continue.
- **`src/lib/claude.ts`** — Facade that delegates to CLI (`claude-cli.ts`, default) or SDK (`claude-sdk.ts`, set `CLAUDE_USE_CLI=false`).
- **`src/lib/claude-sdk.ts`** — Legacy SDK wrapper using `@anthropic-ai/claude-agent-sdk`'s `query()` function. Resolves the `claude` CLI path, auto-approves all tools via `canUseTool`, and handles `AskUserQuestion` interactively by blocking until the browser user answers.
- **`src/lib/process-manager.ts`** — Pipeline orchestration engine. Each operation is a sequence of `PipelinePhase`s (single child, parallel group, or TypeScript function). Function phases get a rich context (`ctx`) with helpers: `emitStatus`, `emitResult`, `emitAsk` (prompt user and await answer), `runChild`, `runChildGroup`, `setWorkspace`. Stores all state (`ManagedOperation` map, counter) on `globalThis` to survive HMR in dev.
- **`src/lib/workspace-ops.ts`** — TypeScript equivalents of shell scripts: task analysis, workspace/repo setup (git clone, worktree creation), workspace snapshot commits. All paths relative to `AI_WORKSPACE_ROOT`.
- **`src/lib/prompts/`** — Prompt builder functions for each agent type (planner, executor, coordinator, reviewer, code-reviewer, todo-verifier, pr-creator, researcher, updater, collector, init-readme). Each exports a `build*Prompt(input)` function.
- **`src/app/api/events/route.ts`** — SSE endpoint. Clients connect with `?operationId=` to stream `OperationEvent`s in real time. Replays existing events on connection, then streams new ones.

### Client-side

- **`src/hooks/use-workspaces.ts`** / **`use-workspace.ts`** — SWR hooks with auto-refresh (10s list, 5s detail) for workspace data.
- **`src/hooks/use-operation.ts`** — Operation lifecycle hook. Persists active operation ID to localStorage (`aiw-op:{key}`) so navigating away and returning reconnects to the SSE stream. Detects `__setWorkspace:` and `__phaseUpdate:` control events from the server.
- **`src/hooks/use-sse.ts`** — EventSource hook for streaming operation output from `/api/events`.
- **`src/lib/stream-parser.ts`** — Converts raw `stream-json` messages (from CLI or SDK) into typed `LogEntry` objects for rendering (text, thinking, tool calls, tool results, ask prompts, system events, etc.).
- **Components** — `workspace-list.tsx` (dashboard), `workspace-card.tsx` (summary card), `operation-panel.tsx` / `operation-log.tsx` / `claude-operation.tsx` (operation UI with log streaming and render-prop pattern), `init-dialog.tsx` (new workspace form).

### Pages

- `/` — Dashboard listing all workspaces
- `/workspace/[name]` — Workspace detail with tabs: Overview, TODOs, Reviews, History, Operations
- `/utilities` — Utility operations (permissions-suggest, workspace-prune)

### API Routes

- `GET /api/workspaces` — List all workspaces
- `GET /api/workspaces/[name]` — Workspace detail
- `GET /api/workspaces/[name]/readme` — Raw README
- `GET /api/workspaces/[name]/todos` — Parsed TODO files
- `GET /api/workspaces/[name]/reviews` — Review sessions
- `GET /api/workspaces/[name]/reviews/[timestamp]` — Review detail
- `GET /api/workspaces/[name]/history` — Git log
- `POST /api/operations/{init,execute,review,create-pr,update-todo,delete}` — Start operations
- `POST /api/operations/answer` — Submit AskUserQuestion answers
- `POST /api/operations/kill` — Kill a running operation
- `GET /api/operations` — List operations
- `GET /api/events?operationId=` — SSE stream for operation output

## Styling

Uses Tailwind with a shadcn/ui-style CSS variable theme system (`hsl(var(--primary))`, etc.) defined in `globals.css`. The `cn()` utility from `src/lib/utils.ts` merges Tailwind classes via `clsx` + `tailwind-merge`. Dark mode is configured via the `class` strategy but not currently toggled.

## Development Rules

- **TDD (Test-Driven Development)**: Write or update tests before implementing production code. When adding a new feature or fixing a bug, first write a failing test that defines the expected behavior, then implement the code to make it pass.
- **Pre-commit checks**: Always run `bun run lint` and `bun run test` before creating a git commit. Both must pass with zero errors.

## Conventions

- Path alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`).
- Types live in `src/types/` — `operation.ts` (Operation, OperationEvent, OperationType, OperationPhaseInfo) and `workspace.ts` (TodoItem, TodoFile, WorkspaceMeta, WorkspaceSummary, WorkspaceDetail, ReviewSession, HistoryEntry).
- `bin/start.mjs` is the CLI entry point. Resolves `AI_WORKSPACE_ROOT` from args/env/cwd, validates workspace directory exists, then spawns `bun run dev` or `bun run start`.
- `NEXT_PUBLIC_GIT_HASH` is injected at build time by `next.config.mjs` for display in the sidebar.
- ESLint uses flat config (`eslint.config.mjs`) with typescript-eslint. Unused vars must be prefixed with `_` (both args and vars).

## Testing

Tests use **Vitest** with jsdom environment, `@testing-library/react`, and `@testing-library/jest-dom` matchers. Test files live in `src/__tests__/` mirroring the `src/` structure (e.g., `src/__tests__/lib/todo-parser.test.ts`). Vitest globals are enabled (no need to import `describe`/`it`/`expect`).

## Key Dependencies

- `@anthropic-ai/claude-agent-sdk` — Legacy SDK for running Claude Code headlessly (used when `CLAUDE_USE_CLI=false`); marked as `serverExternalPackages` in next.config.ts
- `swr` — Client-side data fetching with automatic revalidation
- `react-markdown` + `remark-gfm` — Markdown rendering
- `lucide-react` — Icons
