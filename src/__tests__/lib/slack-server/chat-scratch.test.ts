// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  getSlackScratchDir,
  getSlackScratchRoot,
  SLACK_SCRATCH_DIRNAME,
} from "@/lib/slack-server/chat-scratch";

const ROOT = "/ws";

describe("slack-server/chat-scratch", () => {
  it("resolves the scratch root under .ai-workspace", () => {
    expect(getSlackScratchRoot(ROOT)).toBe(
      path.join(ROOT, ".ai-workspace", SLACK_SCRATCH_DIRNAME),
    );
  });

  it("gives each thread its own directory under the scratch root", () => {
    const a = getSlackScratchDir(ROOT, "1712345678.123456");
    const b = getSlackScratchDir(ROOT, "1712345999.000100");
    expect(a).toBe(path.join(getSlackScratchRoot(ROOT), "1712345678.123456"));
    expect(a).not.toBe(b);
  });

  it("is stable for the same thread key", () => {
    expect(getSlackScratchDir(ROOT, "1712345678.123456")).toBe(
      getSlackScratchDir(ROOT, "1712345678.123456"),
    );
  });

  // The thread key comes from Slack and is interpolated into a prompt the model
  // then uses as a path, so a separator or `..` must not let it name a
  // directory outside the scratch root.
  it.each([
    ["../../etc", "traversal via .."],
    ["a/b", "forward slash"],
    ["a\\b", "backslash"],
    ["..", "bare dotdot"],
    ["...", "dots only"],
    ["", "empty"],
    ["   ", "whitespace only"],
  ])("keeps %s (%s) inside the scratch root", (threadKey) => {
    const dir = getSlackScratchDir(ROOT, threadKey);
    const parent = path.dirname(dir);
    expect(parent).toBe(getSlackScratchRoot(ROOT));
    expect(path.basename(dir)).not.toBe("");
  });
});
