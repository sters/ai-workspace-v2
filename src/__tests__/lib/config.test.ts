import { describe, expect, it } from "vitest";
import { resolveWorkspaceName } from "@/lib/config";

describe("resolveWorkspaceName", () => {
  it("extracts basename from a full path", () => {
    expect(resolveWorkspaceName("/home/user/workspace/my-project")).toBe(
      "my-project"
    );
  });

  it("returns the input if it is already a basename", () => {
    expect(resolveWorkspaceName("my-project")).toBe("my-project");
  });

  it("handles trailing slash", () => {
    // path.basename strips trailing slash on most platforms
    expect(resolveWorkspaceName("/home/user/workspace/my-project/")).toBe(
      "my-project"
    );
  });

  it("handles deeply nested paths", () => {
    expect(resolveWorkspaceName("/a/b/c/d/e/workspace-name")).toBe(
      "workspace-name"
    );
  });

  it("handles paths with dots", () => {
    expect(resolveWorkspaceName("/path/to/my.workspace.name")).toBe(
      "my.workspace.name"
    );
  });
});
