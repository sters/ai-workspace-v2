import {
  buildCoordinatorPrompt,
  getCoordinatorSystemPrompt,
} from "@/lib/templates/prompts/coordinator";
import type { CoordinatorInput } from "@/types/prompts";

describe("getCoordinatorSystemPrompt", () => {
  const prompt = getCoordinatorSystemPrompt();

  it("audits the contract on both sides of the boundary", () => {
    expect(prompt).toContain("Contract Audit");
    // The coordinator is the only agent allowed to read every repo, so it is the
    // only place these can be resolved before the executor freezes a guess in.
    expect(prompt).toMatch(/both sides/i);
  });

  it("names the audit dimensions that break at the wire, not at compile time", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/cardinality|repeated|scalar/);
    expect(lower).toMatch(/nullab|sentinel/);
    expect(lower).toMatch(/ordering/);
    expect(lower).toMatch(/timestamp/);
    expect(lower).toMatch(/id type|typed id/);
    expect(lower).toMatch(/normaliz|prefix/);
  });

  it("requires flagging an acceptance criterion the contract cannot satisfy", () => {
    expect(prompt).toMatch(/acceptance criteri/i);
    expect(prompt).toMatch(/cannot satisfy|cannot be satisfied/i);
    // The failure mode is planning around it silently, so say so.
    expect(prompt).toMatch(/do not silently|rather than silently|never silently/i);
  });

  it("keeps the audit inside the Coordination section it already writes", () => {
    expect(prompt).toContain("## Coordination");
  });
});

describe("buildCoordinatorPrompt", () => {
  const baseInput: CoordinatorInput = {
    workspaceName: "ws",
    workspacePath: "/tmp/ws",
    readmeContent: "# readme",
    todoFiles: [{ repoName: "api", content: "- [ ] do a thing" }],
    repoWorktrees: [
      { repoName: "api", worktreePath: "/tmp/api" },
      { repoName: "web", worktreePath: "/tmp/web" },
    ],
  };

  it("lists worktree paths so the audit can read both sides", () => {
    const prompt = buildCoordinatorPrompt(baseInput);
    expect(prompt).toContain("/tmp/api");
    expect(prompt).toContain("/tmp/web");
  });

  it("includes the README and every TODO file", () => {
    const prompt = buildCoordinatorPrompt(baseInput);
    expect(prompt).toContain("# readme");
    expect(prompt).toContain("TODO-api.md");
    expect(prompt).toContain("do a thing");
  });
});
