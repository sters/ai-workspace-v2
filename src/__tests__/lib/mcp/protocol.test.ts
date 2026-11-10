import { describe, it, expect, vi } from "vitest";
import z from "zod";
import { handleMcpMessage, isLocalOrigin, type McpTool } from "@/lib/mcp/protocol";

const echo: McpTool = {
  name: "echo",
  description: "Echo the text back",
  input: z.object({ text: z.string().min(1, "text is required") }),
  call: async (args) => ({ data: args }),
};

const failing: McpTool = {
  name: "failing",
  description: "Always throws",
  input: z.object({}),
  call: async () => {
    throw new Error("boom");
  },
};

const tools = [echo, failing];

function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("handleMcpMessage", () => {
  it("answers initialize with the requested protocol version when supported", async () => {
    const res = await handleMcpMessage(
      rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
      tools,
    );
    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "ai-workspace" } },
    });
  });

  it("falls back to its latest protocol version for an unknown one", async () => {
    const res = (await handleMcpMessage(rpc("initialize", { protocolVersion: "1999-01-01" }), tools)) as {
      result: { protocolVersion: string };
    };
    expect(res.result.protocolVersion).not.toBe("1999-01-01");
    expect(res.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns nothing for a notification", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools)).toBeNull();
  });

  it("lists tools with an object JSON schema for their input", async () => {
    const res = (await handleMcpMessage(rpc("tools/list"), tools)) as {
      result: { tools: { name: string; inputSchema: { type: string; required?: string[] } }[] };
    };
    expect(res.result.tools.map((t) => t.name)).toEqual(["echo", "failing"]);
    expect(res.result.tools[0].inputSchema.type).toBe("object");
    expect(res.result.tools[0].inputSchema.required).toEqual(["text"]);
  });

  it("calls a tool with validated arguments and returns its data as text", async () => {
    const res = (await handleMcpMessage(rpc("tools/call", { name: "echo", arguments: { text: "hi" } }), tools)) as {
      result: { content: { type: string; text: string }[]; isError?: boolean };
    };
    expect(res.result.isError).toBeFalsy();
    expect(JSON.parse(res.result.content[0].text)).toEqual({ text: "hi" });
  });

  it("reports invalid arguments as a tool error without calling the tool", async () => {
    const call = vi.fn();
    const res = (await handleMcpMessage(
      rpc("tools/call", { name: "spy", arguments: {} }),
      [{ ...echo, name: "spy", call }],
    )) as { result: { content: { text: string }[]; isError: boolean } };
    expect(call).not.toHaveBeenCalled();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/^text: /);
  });

  it("reports a thrown error as a tool error", async () => {
    const res = (await handleMcpMessage(rpc("tools/call", { name: "failing", arguments: {} }), tools)) as {
      result: { content: { text: string }[]; isError: boolean };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("boom");
  });

  it("rejects an unknown tool as invalid params", async () => {
    const res = await handleMcpMessage(rpc("tools/call", { name: "nope", arguments: {} }), tools);
    expect(res).toMatchObject({ id: 1, error: { code: -32602 } });
  });

  it("rejects an unknown method", async () => {
    const res = await handleMcpMessage(rpc("resources/list"), tools);
    expect(res).toMatchObject({ id: 1, error: { code: -32601 } });
  });

  it("rejects a message that is not JSON-RPC", async () => {
    const res = await handleMcpMessage({ hello: "world" }, tools);
    expect(res).toMatchObject({ id: null, error: { code: -32600 } });
  });
});

describe("isLocalOrigin", () => {
  it.each([
    [null, true],
    ["http://localhost:3741", true],
    ["http://127.0.0.1:3741", true],
    ["http://[::1]:3741", true],
    ["https://evil.example.com", false],
    ["http://localhost.evil.example.com", false],
    ["not a url", false],
  ])("%s → %s", (origin, expected) => {
    expect(isLocalOrigin(origin)).toBe(expected);
  });
});
