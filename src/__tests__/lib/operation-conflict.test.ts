// @vitest-environment node
import { describe, it, expect } from "vitest";
import { blocksOperation } from "@/lib/operation-conflict";

describe("blocksOperation", () => {
  it("a workspace-wide operation blocks every repository of its workspace", () => {
    const running = { type: "autonomous" as const, workspace: "ws-a" };
    expect(blocksOperation(running, "ws-a")).toBe(true);
    expect(blocksOperation(running, "ws-a", "widgets")).toBe(true);
    expect(blocksOperation(running, "ws-b")).toBe(false);
  });

  it("a repository operation blocks that repository and workspace-wide operations only", () => {
    const running = { type: "execute" as const, workspace: "ws-a", inputs: { repo: "github.com/acme/widgets" } };
    expect(blocksOperation(running, "ws-a", "widgets")).toBe(true);
    expect(blocksOperation(running, "ws-a", "github.com/acme/widgets")).toBe(true);
    expect(blocksOperation(running, "ws-a")).toBe(true);
    expect(blocksOperation(running, "ws-a", "github.com/acme/gadgets")).toBe(false);
  });

  it("operations that are not about a workspace block nothing", () => {
    expect(blocksOperation({ type: "search", workspace: "deep-search" }, "deep-search")).toBe(false);
    expect(blocksOperation({ type: "init", workspace: "" }, "")).toBe(false);
  });
});
