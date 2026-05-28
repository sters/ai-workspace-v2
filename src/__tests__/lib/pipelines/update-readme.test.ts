import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/templates", () => ({
  buildReadmeUpdaterPrompt: vi.fn(() => "readme-updater-prompt"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/readme-updater.md"),
}));

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const originalBunFile = Bun.file;
Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;

afterAll(() => {
  Bun.file = originalBunFile;
});

import { buildUpdateReadmePipeline } from "@/lib/pipelines/update-readme";

describe("buildUpdateReadmePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("# README");
  });

  it("returns a single phase labeled 'Update README'", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    expect(phases).toHaveLength(1);
    expect(phases[0].kind).toBe("single");
    if (phases[0].kind !== "single") throw new Error("expected single");
    expect(phases[0].label).toBe("Update README");
  });

  it("restricts allowedTools to README.md edit/write + git", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    const phase = phases[0];
    if (phase.kind !== "single") throw new Error("expected single");
    expect(phase.allowedTools).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Edit\(.*README\.md\)/),
        expect.stringMatching(/Write\(.*README\.md\)/),
        "Bash(git:*)",
      ]),
    );
  });

  it("threads interject=true into buildReadmeUpdaterPrompt", async () => {
    const { buildReadmeUpdaterPrompt } = await import("@/lib/templates");
    const mockBuild = vi.mocked(buildReadmeUpdaterPrompt);
    mockBuild.mockClear();

    await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section", interject: true });

    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ interject: true }),
    );
  });

  it("addDirs points at the workspace path", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    const phase = phases[0];
    if (phase.kind !== "single") throw new Error("expected single");
    expect(phase.addDirs).toEqual([expect.stringContaining("test-ws")]);
  });
});
