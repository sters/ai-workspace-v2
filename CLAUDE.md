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

Per-workspace config stored in `~/.config/ai-workspace/{basename}-{hash}/config.yml` (hash = first 8 chars of SHA-256 of the absolute workspace root path). Three-tier priority: env vars > config.yml > defaults. Config resolution in `src/lib/config/resolver.ts`, cached on `globalThis`. Workspace root is resolved first (CLI arg > `AIW_WORKSPACE_ROOT` env > cwd), then the config directory is derived from it.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIW_WORKSPACE_ROOT` | cwd | ai-workspace root (must contain `workspace/` and `repositories/`) |
| `AIW_PORT` | 3741 | Next.js server port |
| `AIW_CHAT_PORT` | 3742 | WebSocket chat server port |
| `AIW_CLAUDE_PATH` | auto-detect | Custom Claude CLI path |
| `AIW_CLAUDE_USE_CLI` | `true` | Use CLI (`true`) or legacy SDK (`false`) |
| `AIW_EDITOR` | `code {path}` | Editor command template |
| `AIW_TERMINAL` | `open -a Terminal {path}` | Terminal command template |

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 3, SWR for data fetching. Bun runtime.

### Key architectural patterns

- **SQLite persistence** — Per-workspace database in `~/.config/ai-workspace/{basename}-{hash}/db.sqlite` via `bun:sqlite`. DB singleton on `globalThis` (`src/lib/db/connection.ts`). Events are buffered in memory and flushed every 500ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Pipeline orchestration** — Operations are sequences of `PipelinePhase`s (single child, parallel group, or TypeScript function). Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Max 3 concurrent operations. Pipeline definitions per operation type in `src/lib/pipelines/`. Recovers interrupted operations on restart (`src/lib/pipeline/resume.ts`).
- **Claude CLI execution** — `src/lib/claude/cli.ts` spawns `claude -p --output-format stream-json`. Handles `AskUserQuestion` via `--resume {session_id}`. Facade in `src/lib/claude/index.ts` delegates to CLI or SDK.
- **SSE streaming** — Clients connect to `/api/events?operationId=` for real-time operation output. Replays existing events on connection.
- **Instrumentation split** — `src/instrumentation.ts` delegates to `src/instrumentation-node.ts` at runtime to avoid bundling Node.js-only imports (SQLite, pipeline resume) into Edge Runtime.
- **Two-server setup** — `bin/start.ts` spawns both Next.js (`bin/next-server.ts`) and WebSocket chat (`bin/chat-server.ts`) as separate processes.
- **Zod validation** — `src/lib/schemas.ts` for HTTP request bodies, `src/lib/runtime-schemas.ts` for untrusted runtime data (JSONL, WebSocket messages, SSE events, CLI stream fragments). Intentionally separate files.

### Server-side key directories

- `src/lib/db/` — SQLite CRUD and migrations
- `src/lib/claude/` — Claude CLI/SDK execution, auth, settings
- `src/lib/pipeline/` — Pipeline orchestration engine
- `src/lib/pipelines/` — Pipeline definitions per operation type (each exports `build*Pipeline()`)
- `src/lib/workspace/` — Filesystem operations (reading workspace state, git ops, setup)
- `src/lib/parsers/` — Markdown parsing (TODO: `[x]`/`[ ]`/`[!]`/`[~]` syntax, README, reviews, stream-json)
- `src/lib/templates/prompts/` — `build*Prompt()` functions for each agent type
- `src/lib/chat-server/` — WebSocket session management with message buffering

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
