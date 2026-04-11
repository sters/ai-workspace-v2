# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for a multi-repository workspace manager for Claude Code. Browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, autonomous, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`. WebSocket chat server on port 3742 for interactive Claude sessions.

## Commands

```bash
bunx github:sters/ai-workspace-v2 [/path/to/ai-workspace]  # Run via bunx
bun install                                                  # Install dependencies
bun run dev:hot                                              # Development with hot reload
bun run build && bun run start                               # Production build + start
bun run lint                    # Runs both tsc --noEmit AND eslint src/
bun run test                    # Run all tests
bun run test:watch              # Run tests in watch mode
bunx vitest run src/__tests__/lib/parsers/todo.test.ts  # Single test file
```

## Configuration

Per-workspace config stored in `{workspaceRoot}/.ai-workspace/config.yml`. Three-tier priority: env vars > config.yml > defaults. Config resolution in `src/lib/config/resolver.ts`, cached on `globalThis`. Workspace root is resolved first (CLI arg > `AIW_WORKSPACE_ROOT` env > cwd), then the config directory is derived from it. Directory layout in `src/lib/config/workspace-dir.ts`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIW_WORKSPACE_ROOT` | cwd | ai-workspace root (must contain `workspace/` and `repositories/`) |
| `AIW_PORT` | 3741 | Next.js server port |
| `AIW_CHAT_PORT` | 3742 | WebSocket chat server port |
| `AIW_CLAUDE_PATH` | auto-detect | Custom Claude CLI path |
| `AIW_CLAUDE_USE_CLI` | `true` | Use CLI (`true`) or legacy SDK (`false`) |
| `AIW_EDITOR` | `code {path}` | Editor command template |
| `AIW_TERMINAL` | `open -a Terminal {path}` | Terminal command template |
| `AIW_DISABLE_ACCESS_LOG` | `false` | Silence Next.js dev access logs (also `server.disableAccessLog` in config.yml) |

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 4, SWR for data fetching. Bun runtime.

### Key architectural patterns

- **SQLite persistence** — Per-workspace database in `{workspaceRoot}/.ai-workspace/db.sqlite` via `bun:sqlite`. DB singleton on `globalThis` (`src/lib/db/connection.ts`). Events are buffered in memory and flushed every 5000ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Pipeline orchestration** — Operations are sequences of `PipelinePhase`s (single child, parallel group, or TypeScript function). Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Max 3 concurrent operations. Pipeline definitions per operation type in `src/lib/pipelines/`. Recovers interrupted operations on restart (`src/lib/pipeline/resume.ts`). Function phases can dynamically add phases via `appendPhases()` — the execution loop re-evaluates `phases.length` each iteration. The `runSubPhases()` utility in `src/lib/pipelines/actions/run-sub-phases.ts` runs sub-pipeline phases within a function phase context, handling all three phase kinds uniformly.
- **Claude CLI execution** — `src/lib/claude/cli.ts` spawns `claude -p --output-format stream-json`. Handles `AskUserQuestion` via `--resume {session_id}`. Facade in `src/lib/claude/index.ts` delegates to CLI or SDK.
- **SSE streaming** — Clients connect to `/api/events?operationId=` for real-time operation output. Replays existing events on connection.
- **Instrumentation split** — `src/instrumentation.ts` delegates to `src/instrumentation-node.ts` at runtime to avoid bundling Node.js-only imports (SQLite, pipeline resume) into Edge Runtime.
- **Two-server setup** — `bin/start.ts` spawns both Next.js (`bin/next-server.ts`) and WebSocket chat (`bin/chat-server.ts`) as separate processes.
- **Zod validation** — `src/lib/schemas.ts` for HTTP request bodies, `src/lib/runtime-schemas.ts` for untrusted runtime data (JSONL, WebSocket messages, SSE events, CLI stream fragments). Intentionally separate files.
- **Best-of-N pattern** — Operations like review, execute, create-pr, update-todo support parallel "candidate" runs. `buildBestOfNPipeline()` in `src/lib/pipelines/best-of-n.ts` runs N candidates, then a synthesizer phase reviews all results. Controlled by `bestOfN` in config (per-operation-type overrides supported).
- **Batch & autonomous chaining** — Batch pipelines chain operation types (init → execute → review → create-pr) with configurable gating. Autonomous mode loops execute → review → create-pr up to `maxLoops` times with autonomous gate logic. Both use `startWith` to indicate the first phase.
- **Phase update markers** — Phase lifecycle is communicated via special JSON prefixes in status events: `"__phaseUpdate:"` and `"__setWorkspace:"`. These are parsed by `parsePhaseUpdatesFromEvents()` / `parsePhaseUpdatesFromEntries()` to rebuild phase arrays from the event stream without needing a separate phases table.
- **Function phase context** — TypeScript function phases receive a `PhaseFunctionContext` with `emitStatus()`, `emitResult()`, `emitAsk()` (blocks until user answers), `runChild()` / `runChildGroup()` (spawn Claude sub-processes), `emitTerminal()` (raw PTY output), `appendPhases()` (dynamic phase injection), `setWorkspace()`, and `signal` (AbortSignal for kills). Child processes accept `allowedTools` (explicit tool restrictions — overrides auto-generated patterns from `addDirs`), `appendSystemPromptFile` (appended to Claude's system prompt), `stepType` (for config-based model resolution), and `skipAskUserQuestion`.
- **Model resolution** — 6-tier priority in `src/lib/config/model.ts`: explicit model > per-operation per-step config > per-operation config > global operations model > code-level `STEP_DEFAULT_MODELS` > CLI default. Step types like `code-review`, `autonomous-gate` default to sonnet; `verify-todo`, `collect-reviews` default to haiku.
- **Phase retries** — Phases support `maxRetries` (default 2) and `retryDelayMs` (default 3000). Per-phase timeouts use separate AbortControllers from the operation-level kill signal.
- **Workspace archiving** — `workspace_archives` table (migration v4). `POST /api/workspaces/[name]/archive` toggles archive. Dashboard filters via `recentOnly` (skips workspaces older than 1 week) and `includeArchived` query params.
- **TODO normalization** — `normalizeTodoCheckboxes()` fixes common LLM formatting errors (missing checkboxes, bracket spacing, asterisk bullets). `stripCompletedTodoItems()` removes `[x]` items before update-todo runs. Both prevent autonomous loops.

### Server-side key directories

- `src/lib/db/` — SQLite CRUD and migrations
- `src/lib/claude/` — Claude CLI/SDK execution, auth, settings
- `src/lib/pipeline/` — Pipeline orchestration engine
- `src/lib/pipelines/` — Pipeline definitions per operation type (each exports `build*Pipeline()`)
- `src/lib/workspace/` — Filesystem operations (reading workspace state, git ops, setup)
- `src/lib/parsers/` — Markdown parsing (TODO: `[x]`/`[ ]`/`[!]`/`[~]` syntax, README, reviews, stream-json)
- `src/lib/templates/prompts/` — `build*Prompt()` functions for each agent type
- `src/lib/chat-server/` — WebSocket session management with message buffering
- `src/lib/operation-store/` — Reads completed operations from disk (JSONL/JSON files)
- `src/lib/web-push/` — Browser push notification subscriptions for operation completion
- `src/lib/config/model.ts` — 6-tier model resolution logic
- `src/lib/pipelines/actions/` — Reusable pipeline building blocks (`run-sub-phases.ts`, TODO stripping/normalization)

### Client-side

- `src/hooks/` — SWR hooks with auto-refresh, operation lifecycle with localStorage persistence, SSE streaming
- `src/components/` — `dashboard/`, `workspace/`, `operation/`, `shared/`

## Development Rules

- **TDD**: Write or update tests before implementing production code. First write a failing test, then implement.
- **Pre-commit checks**: Always run `bun run lint` and `bun run test` before committing. Both must pass with zero errors.
- **Git commands**: Run `git add`, `git commit`, and `git push` as separate commands — never chain them. Do not use `$()` substitution in git commands.

## Conventions

- Path alias: `@/*` → `./src/*`
- **`globalThis` pattern**: Mutable state (DB connection, pipeline operations, app config, chat sessions) stored on `globalThis` to survive Next.js HMR. Tests must account for this (see `test-setup.ts`).
- **`force-dynamic`**: All API routes export `const dynamic = "force-dynamic"`.
- ESLint flat config (`eslint.config.ts`): unused vars must be prefixed with `_`. `bin/**` is excluded from linting.
- `bun:sqlite` and `@anthropic-ai/claude-agent-sdk` are in `serverExternalPackages` in `next.config.ts`.
- Types in `src/types/`, test files in `src/__tests__/` mirroring `src/` structure.

## Testing

Vitest with jsdom, `@testing-library/react`, `@testing-library/jest-dom`. Globals enabled (no need to import `describe`/`it`/`expect`). `tsconfig.json` excludes test files — Vitest handles type-checking separately from `tsc --noEmit`.

## Gotchas

- **Config is cached on first access** — `getConfig()` stores on globalThis. Changes to `config.yml` require `_resetConfig()` to take effect. Tests must call reset functions in order: `_resetDb()` → `_resetConfig()` → `_resetWorkspaceRoot()`.
- **Event buffering is async** — Events aren't persisted immediately (500ms flush interval). Don't query events from the DB immediately after emitting them. SSE streaming replays from the in-memory buffer so clients see events before flush.
- **Workspace root must be set before config/DB** — The entire config directory and DB path depend on workspace root being known first. `bin/start.ts` calls `setWorkspaceRoot()` before `getConfig()`.
- **Function phase timeouts use separate AbortControllers** — Per-phase timeouts don't permanently abort the shared `managed.abortController` (which is for user-initiated kills). This is intentional to prevent timeout from killing the whole operation.
- **Running vs completed operations live in different stores** — Running operations are in-memory (`src/lib/pipeline/store.ts`). Completed ones are on disk. `/api/operations` merges both, with running taking precedence on dedup.
- **JSONL auto-migration** — On first startup, `getDb()` triggers `migrateJsonlToSqlite()` which imports legacy `.operations/` JSONL files if the SQLite table is empty.
- **Dev mode clears `.next` cache** — `bin/next-server.ts` removes `.next` on dev/hot startup to avoid stale route issues.
