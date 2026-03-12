/**
 * Zod schemas for runtime validation of external/untrusted data:
 * - Files read from disk (JSONL, .mcp.json, ~/.claude.json)
 * - WebSocket messages from clients
 * - localStorage data
 * - SSE stream events
 * - Claude CLI stream-json output fragments
 *
 * These are separate from schemas.ts (HTTP request body validation).
 */

import z from "zod";

// ---------------------------------------------------------------------------
// Operation store (JSONL files in .operations/)
// ---------------------------------------------------------------------------

/** Loose operation schema — validates key fields without duplicating the full Operation type. */
const operationLoose = z.object({
  id: z.string(),
  type: z.string(),
  workspace: z.string(),
  status: z.string(),
  startedAt: z.string(),
}).passthrough();

export const storedHeaderSchema = z.object({
  _type: z.literal("header"),
  operation: operationLoose,
});

export const storedEventSchema = z.object({
  _type: z.literal("event"),
}).passthrough();

// ---------------------------------------------------------------------------
// MCP server config (.mcp.json / ~/.claude.json)
// ---------------------------------------------------------------------------

const mcpStdioConfigSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
}).passthrough();

const mcpSseConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
}).passthrough();

const mcpHttpConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
}).passthrough();

export const mcpServerConfigSchema = z.union([
  mcpSseConfigSchema,
  mcpHttpConfigSchema,
  mcpStdioConfigSchema, // last — its `type` is optional so it acts as fallback
]);

export const mcpFileSchema = z.object({
  mcpServers: z.record(z.unknown()),
}).passthrough();

export const claudeJsonProjectSchema = z.object({
  mcpServers: z.record(z.unknown()),
}).passthrough();

// ---------------------------------------------------------------------------
// Claude CLI stream-json fragments (used in parsers/stream.ts and cli.ts)
// ---------------------------------------------------------------------------

export const askQuestionItemSchema = z.object({
  question: z.string(),
  options: z.array(z.object({
    label: z.string(),
    description: z.string(),
  }).passthrough()).optional().default([]),
  multiSelect: z.boolean().optional().default(false),
});

export const permissionDenialItemSchema = z.object({
  tool_name: z.string(),
  tool_input: z.record(z.unknown()).optional(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// WebSocket ClientMessage (chat-server.ts)
// ---------------------------------------------------------------------------

const wsStartSchema = z.object({
  type: z.literal("start"),
  workspaceId: z.string().min(1),
  initialPrompt: z.string().optional(),
  reviewTimestamp: z.string().optional(),
});

const wsInputSchema = z.object({
  type: z.literal("input"),
  data: z.string(),
});

const wsResizeSchema = z.object({
  type: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

const wsKillSchema = z.object({
  type: z.literal("kill"),
});

const wsResumeSchema = z.object({
  type: z.literal("resume"),
  sessionId: z.string().min(1),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  wsStartSchema,
  wsInputSchema,
  wsResizeSchema,
  wsKillSchema,
  wsResumeSchema,
]);

// ---------------------------------------------------------------------------
// Client-side: localStorage and SSE events
// ---------------------------------------------------------------------------

export const operationListItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  workspace: z.string(),
  status: z.string(),
  startedAt: z.string(),
}).passthrough();

export const operationEventSchema = z.object({
  type: z.enum(["output", "error", "complete", "status", "terminal"]),
  operationId: z.string(),
  data: z.string(),
  timestamp: z.string(),
}).passthrough();
