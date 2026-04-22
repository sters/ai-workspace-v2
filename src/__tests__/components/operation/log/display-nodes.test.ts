import { describe, expect, it } from "vitest";
import type { LogEntry, DisplayNode } from "@/types/claude";
import { buildDisplayNodes } from "@/components/operation/log/display-nodes";

// Helper to create LogEntry objects concisely
function text(content: string, parentToolUseId?: string): LogEntry {
  return { kind: "text", content, parentToolUseId };
}

function toolCall(
  toolName: string,
  toolId: string,
  summary: string,
  parentToolUseId?: string
): LogEntry {
  return { kind: "tool_call", toolName, toolId, summary, parentToolUseId };
}

function toolResult(toolId: string, content: string, parentToolUseId?: string, isError = false): LogEntry {
  return { kind: "tool_result", toolId, content, isError, parentToolUseId };
}

function systemTask(
  taskToolUseId: string,
  taskStatus: string,
  content: string,
  opts?: { taskSummary?: string; taskUsage?: string; parentToolUseId?: string }
): LogEntry {
  return {
    kind: "system",
    content,
    taskToolUseId,
    taskStatus,
    taskSummary: opts?.taskSummary,
    taskUsage: opts?.taskUsage,
    parentToolUseId: opts?.parentToolUseId,
  };
}

describe("buildDisplayNodes", () => {
  it("returns plain entries when no sub-agents exist", () => {
    const entries: LogEntry[] = [
      text("hello"),
      text("world"),
    ];
    const nodes = buildDisplayNodes(entries);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("entry");
    expect(nodes[1].type).toBe("entry");
  });

  it("groups single-level sub-agent entries (Task tool)", () => {
    const entries: LogEntry[] = [
      text("top-level message"),
      toolCall("Task", "task-1", "Research codebase"),
      systemTask("task-1", "running", "Task started: Research codebase"),
      text("sub-agent thinking", "task-1"),
      toolCall("Grep", "grep-1", "searching", "task-1"),
      toolResult("grep-1", "found it", "task-1"),
      systemTask("task-1", "completed", "Task done", {
        taskSummary: "Found the answer",
        taskUsage: "5.2s, 3 tools",
      }),
      toolResult("task-1", "Research complete"),
      text("after sub-agent"),
    ];

    const nodes = buildDisplayNodes(entries);

    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("entry");

    const subagent = nodes[1] as Extract<DisplayNode, { type: "subagent" }>;
    expect(subagent.type).toBe("subagent");
    expect(subagent.toolUseId).toBe("task-1");
    expect(subagent.status).toBe("completed");
    expect(subagent.summary).toBe("Found the answer");
    expect(subagent.usage).toBe("5.2s, 3 tools");
    expect(subagent.children).toHaveLength(3);

    expect(nodes[2].type).toBe("entry");
  });

  it("groups single-level sub-agent entries (Agent tool)", () => {
    // CLI uses "Agent" instead of "Task"
    const entries: LogEntry[] = [
      text("top-level"),
      toolCall("Agent", "agent-1", "Count Go files"),
      systemTask("agent-1", "running", "Task started: Count Go files"),
      toolCall("Glob", "glob-1", "**/*.go", "agent-1"),
      toolResult("glob-1", "found 42 files", "agent-1"),
      toolResult("agent-1", "Found 42 Go files"),
    ];

    const nodes = buildDisplayNodes(entries);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("entry");

    const subagent = nodes[1] as Extract<DisplayNode, { type: "subagent" }>;
    expect(subagent.type).toBe("subagent");
    expect(subagent.toolUseId).toBe("agent-1");
    // No task_notification, so status is inferred from tool_result
    expect(subagent.status).toBe("completed");
    expect(subagent.children).toHaveLength(2);
  });

  it("infers completion from tool_result when no task_notification exists", () => {
    const entries: LogEntry[] = [
      toolCall("Agent", "a1", "Do something"),
      systemTask("a1", "running", "Task started: Do something"),
      text("working...", "a1"),
      // No task_notification, just tool_result
      toolResult("a1", "done"),
    ];

    const nodes = buildDisplayNodes(entries);
    expect(nodes).toHaveLength(1);

    const agent = nodes[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(agent.status).toBe("completed");
  });

  it("infers failed status from error tool_result", () => {
    const entries: LogEntry[] = [
      toolCall("Agent", "a1", "Do something"),
      systemTask("a1", "running", "Task started: Do something"),
      text("working...", "a1"),
      toolResult("a1", "error occurred", undefined, true),
    ];

    const nodes = buildDisplayNodes(entries);
    expect(nodes).toHaveLength(1);

    const agent = nodes[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(agent.status).toBe("failed");
  });

  it("groups nested sub-agent entries within parent sub-agent", () => {
    const entries: LogEntry[] = [
      text("top-level"),
      toolCall("Task", "outer-1", "Outer task"),
      systemTask("outer-1", "running", "Task started: Outer task"),
      text("outer thinking", "outer-1"),
      toolCall("Task", "inner-1", "Inner task", "outer-1"),
      systemTask("inner-1", "running", "Task started: Inner task", {
        parentToolUseId: "outer-1",
      }),
      text("inner thinking", "inner-1"),
      toolCall("Read", "read-1", "reading file", "inner-1"),
      toolResult("read-1", "file content", "inner-1"),
      systemTask("inner-1", "completed", "Inner done", {
        taskSummary: "Inner result",
        parentToolUseId: "outer-1",
      }),
      toolResult("inner-1", "inner result", "outer-1"),
      text("outer after inner", "outer-1"),
      systemTask("outer-1", "completed", "Outer done", {
        taskSummary: "Outer result",
      }),
      toolResult("outer-1", "outer result"),
    ];

    const nodes = buildDisplayNodes(entries);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("entry");

    const outer = nodes[1] as Extract<DisplayNode, { type: "subagent" }>;
    expect(outer.type).toBe("subagent");
    expect(outer.toolUseId).toBe("outer-1");
    expect(outer.status).toBe("completed");

    // Outer children: text("outer thinking"), inner subagent, text("outer after inner")
    expect(outer.children).toHaveLength(3);
    expect(outer.children[0].type).toBe("entry");

    const inner = outer.children[1] as Extract<DisplayNode, { type: "subagent" }>;
    expect(inner.type).toBe("subagent");
    expect(inner.toolUseId).toBe("inner-1");
    expect(inner.status).toBe("completed");
    expect(inner.summary).toBe("Inner result");

    expect(inner.children).toHaveLength(3);

    expect(outer.children[2].type).toBe("entry");
  });

  it("propagates completion status for nested sub-agents", () => {
    const entries: LogEntry[] = [
      toolCall("Task", "t1", "Parent task"),
      systemTask("t1", "running", "Task started: Parent task"),
      toolCall("Task", "t2", "Child task", "t1"),
      systemTask("t2", "running", "Task started: Child task", { parentToolUseId: "t1" }),
      text("child work", "t2"),
      systemTask("t2", "failed", "Child failed", { parentToolUseId: "t1" }),
      toolResult("t2", "error", "t1"),
      systemTask("t1", "completed", "Parent done"),
      toolResult("t1", "done"),
    ];

    const nodes = buildDisplayNodes(entries);
    expect(nodes).toHaveLength(1);

    const parent = nodes[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(parent.status).toBe("completed");

    const child = parent.children[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(child.type).toBe("subagent");
    expect(child.status).toBe("failed");
    expect(child.children).toHaveLength(1);
  });

  it("handles orphan sub-agents (task_started without tool_call)", () => {
    const entries: LogEntry[] = [
      text("before"),
      systemTask("orphan-1", "running", "Task started: Orphan task"),
      text("orphan work", "orphan-1"),
      systemTask("orphan-1", "completed", "Orphan done", {
        taskSummary: "Orphan summary",
      }),
    ];

    const nodes = buildDisplayNodes(entries);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("entry");

    const orphan = nodes[1] as Extract<DisplayNode, { type: "subagent" }>;
    expect(orphan.type).toBe("subagent");
    expect(orphan.toolUseId).toBe("orphan-1");
    expect(orphan.status).toBe("completed");
    expect(orphan.children).toHaveLength(1);
  });

  it("handles three levels of nesting", () => {
    const entries: LogEntry[] = [
      toolCall("Task", "l1", "Level 1"),
      systemTask("l1", "running", "Task started: Level 1"),
      toolCall("Task", "l2", "Level 2", "l1"),
      systemTask("l2", "running", "Task started: Level 2", { parentToolUseId: "l1" }),
      toolCall("Task", "l3", "Level 3", "l2"),
      systemTask("l3", "running", "Task started: Level 3", { parentToolUseId: "l2" }),
      text("deep work", "l3"),
      systemTask("l3", "completed", "L3 done", { parentToolUseId: "l2" }),
      toolResult("l3", "l3 result", "l2"),
      systemTask("l2", "completed", "L2 done", { parentToolUseId: "l1" }),
      toolResult("l2", "l2 result", "l1"),
      systemTask("l1", "completed", "L1 done"),
      toolResult("l1", "l1 result"),
    ];

    const nodes = buildDisplayNodes(entries);
    expect(nodes).toHaveLength(1);

    const l1 = nodes[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(l1.toolUseId).toBe("l1");
    expect(l1.children).toHaveLength(1);

    const l2 = l1.children[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(l2.toolUseId).toBe("l2");
    expect(l2.children).toHaveLength(1);

    const l3 = l2.children[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(l3.toolUseId).toBe("l3");
    expect(l3.status).toBe("completed");
    expect(l3.children).toHaveLength(1);
    expect(l3.children[0].type).toBe("entry");
  });

  it("handles CLI Agent tool with parallel sub-agents (real-world pattern)", () => {
    // This mimics the actual CLI output: multiple Agent calls in parallel,
    // no task_notification, child entries interleaved
    const entries: LogEntry[] = [
      text("Starting verification"),
      toolCall("Read", "read-0", "/path/to/file"),
      toolResult("read-0", "file content"),
      text("Spawning 3 sub-agents"),
      toolCall("Agent", "a1", "Count Go files"),
      systemTask("a1", "running", "Task started: Count Go files"),
      toolCall("Agent", "a2", "Find Makefile targets"),
      systemTask("a2", "running", "Task started: Find Makefile targets"),
      // a1 child entries
      toolCall("Glob", "glob-1", "**/*.go", "a1"),
      toolResult("glob-1", "42 files", "a1"),
      toolCall("Agent", "a3", "Check README"),
      systemTask("a3", "running", "Task started: Check README"),
      // a2 child entries
      toolCall("Read", "read-1", "Makefile", "a2"),
      toolResult("read-1", "make targets", "a2"),
      // a1 more work
      toolCall("Read", "read-2", "main.go", "a1"),
      toolResult("read-2", "package main", "a1"),
      // a3 child entries
      toolCall("Read", "read-3", "README.md", "a3"),
      toolResult("read-3", "readme content", "a3"),
      // All complete (tool_results, no task_notifications)
      toolResult("a1", "Found 42 Go files"),
      toolResult("a3", "README looks good"),
      toolResult("a2", "Found make targets"),
      text("All done"),
    ];

    const nodes = buildDisplayNodes(entries);

    // text, Read+result, text, a1, a2, a3, text
    const entryNodes = nodes.filter(n => n.type === "entry");
    const subagentNodes = nodes.filter(n => n.type === "subagent");

    expect(subagentNodes).toHaveLength(3);

    const a1 = subagentNodes.find(n => n.type === "subagent" && n.toolUseId === "a1") as Extract<DisplayNode, { type: "subagent" }>;
    expect(a1.status).toBe("completed");
    expect(a1.description).toBe("Count Go files");
    // a1 children: Glob call, Glob result, Read call, Read result
    expect(a1.children).toHaveLength(4);

    const a2 = subagentNodes.find(n => n.type === "subagent" && n.toolUseId === "a2") as Extract<DisplayNode, { type: "subagent" }>;
    expect(a2.status).toBe("completed");
    expect(a2.children).toHaveLength(2);

    const a3 = subagentNodes.find(n => n.type === "subagent" && n.toolUseId === "a3") as Extract<DisplayNode, { type: "subagent" }>;
    expect(a3.status).toBe("completed");
    expect(a3.children).toHaveLength(2);

    // "Starting verification", Read, tool_result(Read), "Spawning 3 sub-agents", "All done"
    expect(entryNodes).toHaveLength(5);
  });

  it("does not promote Bash tool calls to sub-agents when CLI sends task_started for them", () => {
    // The CLI emits task_started/task_notification for long-running tool calls
    // (e.g. Bash) inside sub-agents, not just for Agent/Task sub-agents.
    // These should NOT create separate sub-agent sections.
    const entries: LogEntry[] = [
      text("Starting work"),
      toolCall("Agent", "agent-1", "Update TODOs"),
      systemTask("agent-1", "running", "Task started: Update TODOs"),
      // Sub-agent uses Bash, CLI also sends task_started for it
      toolCall("Bash", "bash-1", "$ find /path -type f", "agent-1"),
      systemTask("bash-1", "running", "Task started: find /path -type f"),
      toolResult("bash-1", "file1.ts\nfile2.ts", "agent-1"),
      // Sub-agent uses another Bash
      toolCall("Bash", "bash-2", "$ grep -r pattern /path", "agent-1"),
      systemTask("bash-2", "running", "Task started: grep -r pattern /path"),
      toolResult("bash-2", "match found", "agent-1"),
      // Agent completes
      systemTask("agent-1", "completed", "Task completed", {
        taskSummary: "Updated TODOs",
        taskUsage: "10.0s, 4 tools",
      }),
      toolResult("agent-1", "TODOs updated"),
      text("Done"),
    ];

    const nodes = buildDisplayNodes(entries);

    const subagentNodes = nodes.filter(n => n.type === "subagent");
    const entryNodes = nodes.filter(n => n.type === "entry");

    // Only one sub-agent section (the Agent), NOT three
    expect(subagentNodes).toHaveLength(1);

    const agent = subagentNodes[0] as Extract<DisplayNode, { type: "subagent" }>;
    expect(agent.toolUseId).toBe("agent-1");
    expect(agent.description).toBe("Update TODOs");
    expect(agent.status).toBe("completed");
    // Bash tool calls and results are inside the agent, not at the top level
    expect(agent.children).toHaveLength(4); // bash-1 call, bash-1 result, bash-2 call, bash-2 result

    // Only "Starting work" and "Done" at top level
    expect(entryNodes).toHaveLength(2);
  });
});
