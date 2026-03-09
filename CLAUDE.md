# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for [ai-workspace](https://github.com/sters/ai-workspace), a multi-repository workspace manager for Claude Code. Provides a browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json` (with SDK fallback via `CLAUDE_USE_CLI=false`).

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

The app runs on port 3741. Set `AI_WORKSPACE_ROOT` env var to point to the ai-workspace root directory (containing `workspace/` and `repositories/`). When running via `bunx`, it can also be passed as a CLI argument or defaults to the current working directory.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, and SWR for data fetching.

### Server-side: Reading workspace state from disk

API routes under `src/app/api/` read workspace data directly from the filesystem (`workspace/` directory in ai-workspace root):

- **`src/lib/workspace/reader.ts`** — Core functions that scan `WORKSPACE_DIR` to list workspaces, read README.md, TODO files, review artifacts, and git history. All filesystem access happens here.
- **`src/lib/config.ts`** — Resolves `AI_WORKSPACE_ROOT` (from env or `..` fallback) and `WORKSPACE_DIR` paths.
- **`src/lib/parsers/`** — Extract structured data from markdown files using regex:
  - `todo.ts` — TODO items use checkbox syntax: `[x]` completed, `[ ]` pending, `[!]` blocked, `[~]` in-progress.
  - `readme.ts` — Parse workspace metadata from README.md.
  - `review.ts` — Parse review session summaries.
  - `stream.ts` — Converts raw `stream-json` messages (from CLI or SDK) into typed `LogEntry` objects for rendering.

### Server-side: Running Claude Code operations

Operations (init, execute, review, create-pr, etc.) spawn Claude Code processes via `Bun.spawn`:

- **`src/lib/claude/`** — Claude CLI/SDK execution and authentication:
  - `index.ts` — Facade that delegates to CLI (default) or SDK (set `CLAUDE_USE_CLI=false`).
  - `cli.ts` — Spawns `claude -p` with `--output-format stream-json` via `Bun.spawn`. Handles `AskUserQuestion` by detecting permission denials and using `--resume {session_id}` to inject answers and continue.
  - `sdk.ts` — Legacy SDK wrapper using `@anthropic-ai/claude-agent-sdk`'s `query()` function. Resolves the `claude` CLI path, auto-approves all tools via `canUseTool`.
  - `login.ts` — Claude auth status checking and login via `Bun.spawn`.
  - `version.ts` — Claude CLI version checking.
  - `mcp.ts` — MCP server discovery and status from `.mcp.json` (project) and `~/.claude.json` (user). Parses `claude mcp list` output.
  - `settings.ts` — Reads/writes Claude settings from three scopes: project (`.claude/settings.json`), local (`.claude/settings.local.json`), and user (`~/.claude/settings.json`).
- **`src/lib/pipeline-manager.ts`** — Pipeline orchestration engine. Each operation is a sequence of `PipelinePhase`s (single child, parallel group, or TypeScript function). Function phases get a rich context (`ctx`) with helpers: `emitStatus`, `emitResult`, `emitAsk` (prompt user and await answer), `runChild`, `runChildGroup`, `setWorkspace`. Stores all state (`ManagedOperation` map, counter) on `globalThis` to survive HMR in dev. Max 3 concurrent operations; phase timeouts default to 20min (Claude) / 3min (functions).
- **`src/lib/operation-store.ts`** — File-based operation persistence. Stores operation events as JSONL files in `.operations/` directory.
- **`src/lib/schemas.ts`** — Zod validation schemas for all operation request bodies (init, execute, review, create-pr, update-todo, create-todo, batch, mcp-auth, etc.).
- **`src/lib/workspace/`** — TypeScript equivalents of shell scripts. All paths relative to `AI_WORKSPACE_ROOT`:
  - `index.ts` — Barrel export for all workspace modules.
  - `helpers.ts` — `exec()`, `repoDir()`, `sanitizeSlug()`, staleness utilities.
  - `setup.ts` — `setupWorkspace()`, `setupRepository()`, `detectBaseBranch()`, `parseAnalysisResultText()`.
  - `git.ts` — `listWorkspaceRepos()`, `commitWorkspaceSnapshot()`, `deleteWorkspace()`.
  - `templates.ts` — I/O wrappers: `writeTodoTemplate()`, `writeReportTemplates()`, `prepareReviewDir()`. Template content lives in `src/lib/templates/`.
  - `pr.ts` — `checkExistingPR()`, `getRepoChanges()`.
- **`src/lib/templates/`** — All template strings and prompt builders, organized by concern:
  - `todo.ts` — TODO template strings for each task type + `selectTodoTemplate()`.
  - `reports.ts` — Report template strings (review, verification, research, summary) + `REPORT_TEMPLATES` map.
  - `readme.ts` — `buildReadmeContent()` for new workspace READMEs.
  - `prompts/` — Prompt builder functions for each agent type (planner, executor, coordinator, reviewer, code-reviewer, todo-verifier, pr-creator, researcher, updater, collector, init-readme, chat). Each exports a `build*Prompt(input)` function.
  - `index.ts` — Barrel re-export of all templates and prompts.
- **`src/lib/pipelines/`** — Pipeline definitions for each operation type (init, execute, review, create-pr, etc.). Each file exports a `build*Pipeline()` function that returns a sequence of `PipelinePhase`s. Shared reusable actions (commit-snapshot, coordinate-todos, setup-repository, etc.) live in `actions/`.
- **`src/app/api/events/route.ts`** — SSE endpoint. Clients connect with `?operationId=` to stream `OperationEvent`s in real time. Replays existing events on connection, then streams new ones.

### Client-side

- **`src/hooks/use-workspaces.ts`** / **`use-workspace.ts`** — SWR hooks with auto-refresh (10s list, 5s detail) for workspace data.
- **`src/hooks/use-operation.ts`** — Operation lifecycle hook. Persists active operation ID to localStorage (`aiw-op:{key}`) so navigating away and returning reconnects to the SSE stream. Detects `__setWorkspace:` and `__phaseUpdate:` control events from the server.
- **`src/hooks/use-sse.ts`** — EventSource hook for streaming operation output from `/api/events`.
- **Components**:
  - `dashboard/` — `workspace-list.tsx` (dashboard), `workspace-card.tsx` (summary card).
  - `workspace/` — `operation-panel.tsx`, `readme-viewer.tsx`, `todo-viewer.tsx`, `review-viewer.tsx`, `history-timeline.tsx`, `chat-terminal.tsx`.
  - `operation/` — Operation execution UI: `claude-operation.tsx` (render-prop wrapper), `log/` (split into `index.tsx`, `display-nodes.ts`, `sections.tsx`, `entries.tsx`, `ask-input.tsx`), `next-action-suggestions.tsx`, `mcp-auth-terminal.tsx`.
  - `shared/` — Generic UI primitives: `status-badge.tsx`, `progress-bar.tsx`, `markdown-renderer.tsx`, `monaco-editor-lazy.tsx`.

### Pages

- `/` — Dashboard listing all workspaces
- `/workspace/[name]` — Workspace detail with tabs: Overview, TODOs, Reviews, History, Operations
- `/workspace/[name]/chat` — Chat interface for workspace
- `/workspace/[name]/todo` — TODO management
- `/utilities` — Utility hub: claude-auth, claude-version, claude-settings (project/user/local), mcp-servers, running operations, workspace-prune

### API Routes

- `GET /api/workspaces` — List all workspaces
- `GET /api/workspaces/[name]` — Workspace detail
- `GET /api/workspaces/[name]/readme` — Raw README
- `GET /api/workspaces/[name]/todos` — Parsed TODO files
- `GET /api/workspaces/[name]/reviews` — Review sessions
- `GET /api/workspaces/[name]/reviews/[timestamp]` — Review detail
- `GET /api/workspaces/[name]/history` — Git log
- `POST /api/operations/{init,execute,review,create-pr,update-todo,create-todo,delete,batch,mcp-auth}` — Start operations
- `POST /api/operations/answer` — Submit AskUserQuestion answers
- `POST /api/operations/kill` — Kill a running operation
- `POST /api/operations/open-vscode` — Open workspace in VS Code
- `GET /api/operations` — List operations
- `GET /api/events?operationId=` — SSE stream for operation output
- `GET /api/claude-auth` — Claude authentication status
- `GET /api/claude-version` — Claude CLI version
- `GET /api/claude-settings` — Read Claude settings (all scopes)
- `POST /api/claude-settings/add-permission` — Add tool permission
- `GET /api/mcp-servers` — List MCP server configurations
- `GET /api/mcp-servers/status` — MCP server connection statuses

## Styling

Uses Tailwind with a shadcn/ui-style CSS variable theme system (`hsl(var(--primary))`, etc.) defined in `globals.css`. The `cn()` utility from `src/lib/utils.ts` merges Tailwind classes via `clsx` + `tailwind-merge`. Dark mode is configured via the `class` strategy but not currently toggled.

## Development Rules

- **TDD (Test-Driven Development)**: Write or update tests before implementing production code. When adding a new feature or fixing a bug, first write a failing test that defines the expected behavior, then implement the code to make it pass.
- **Pre-commit checks**: Always run `bun run lint` and `bun run test` before creating a git commit. Both must pass with zero errors.

## Conventions

- Path alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`).
- Types live in `src/types/` — `operation.ts` (Operation, OperationEvent, OperationType, OperationPhaseInfo), `workspace.ts` (TodoItem, TodoFile, WorkspaceMeta, WorkspaceSummary, WorkspaceDetail, ReviewSession, HistoryEntry), `claude.ts` (ClaudeProcess, RunClaudeOptions, LogEntry types), `pipeline.ts` (PipelinePhase, PhaseFunctionContext), `prompts.ts` (prompt input interfaces), `pty.ts` (DataListener).
- `bin/start.ts` is the CLI entry point. Resolves `AI_WORKSPACE_ROOT` from args/env/cwd, validates workspace directory exists, then spawns `bun run dev` or `bun run start`. Supports `--self-update` flag for bunx users. Additional entry points: `bin/chat-server.ts` (standalone chat), `bin/next-server.ts` (direct Next.js server).
- `NEXT_PUBLIC_GIT_HASH` is injected at build time by `next.config.ts` for display in the sidebar.
- ESLint uses flat config (`eslint.config.ts`) with typescript-eslint. Unused vars must be prefixed with `_` (both args and vars).

## Testing

Tests use **Vitest** with jsdom environment, `@testing-library/react`, and `@testing-library/jest-dom` matchers. Test files live in `src/__tests__/` mirroring the `src/` structure (e.g., `src/__tests__/lib/parsers/todo.test.ts`). Vitest globals are enabled (no need to import `describe`/`it`/`expect`).

## Key Dependencies

- `@anthropic-ai/claude-agent-sdk` — Legacy SDK for running Claude Code headlessly (used when `CLAUDE_USE_CLI=false`); marked as `serverExternalPackages` in next.config.ts
- `swr` — Client-side data fetching with automatic revalidation
- `react-markdown` + `remark-gfm` — Markdown rendering
- `lucide-react` — Icons
