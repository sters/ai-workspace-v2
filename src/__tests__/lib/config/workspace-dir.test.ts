import { describe, expect, it } from "vitest";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";

describe("getWorkspaceConfigDir", () => {
  it("returns .ai-workspace under workspace root", () => {
    const dir = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(dir).toBe("/home/user/my-workspace/.ai-workspace");
  });

  it("normalizes trailing slash via path.resolve", () => {
    const a = getWorkspaceConfigDir("/home/user/my-workspace");
    const b = getWorkspaceConfigDir("/home/user/my-workspace/");
    expect(a).toBe(b);
  });
});
