import { describe, expect, it } from "vitest";
import { getTaskChatSystemPrompt } from "@/lib/templates/prompts/chat";
import {
  buildSlackWorkspaceChatPrompt,
  buildSlackWorkspacePlanPrompt,
  getSlackWorkspaceChatSystemPrompt,
  parseSlackWorkspacePlan,
} from "@/lib/templates/prompts/slack-workspace-chat";

const REPOS = [
  { repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" },
  { repoPath: "github.com/acme/api", repoName: "api", baseBranch: "" },
];

describe("buildSlackWorkspacePlanPrompt", () => {
  it("offers every cloned repository and the request", () => {
    const out = buildSlackWorkspacePlanPrompt("fix the login crash in web", REPOS);
    expect(out).toContain("github.com/acme/web");
    expect(out).toContain("github.com/acme/api");
    expect(out).toContain("fix the login crash in web");
  });

  it("still asks with nothing cloned, since the request may name a repository", () => {
    expect(buildSlackWorkspacePlanPrompt("work on github.com/acme/new", [])).toMatch(/none cloned yet/i);
  });
});

describe("parseSlackWorkspacePlan", () => {
  it("reads the structured answer", () => {
    expect(
      parseSlackWorkspacePlan('{"repositories":["github.com/acme/web"],"taskType":"bugfix","name":"Fix login crash"}'),
    ).toEqual({ repositories: ["github.com/acme/web"], taskType: "bugfix", name: "Fix login crash" });
  });

  it("drops blank and repeated repositories", () => {
    expect(
      parseSlackWorkspacePlan('{"repositories":["github.com/acme/web"," ","github.com/acme/web"],"taskType":"feature","name":"x"}')
        ?.repositories,
    ).toEqual(["github.com/acme/web"]);
  });

  it("falls back to feature for a task type quick create does not take", () => {
    expect(parseSlackWorkspacePlan('{"repositories":[],"taskType":"chore","name":"x"}')?.taskType).toBe("feature");
  });

  it("returns null for text that is not the answer", () => {
    expect(parseSlackWorkspacePlan("I could not decide")).toBeNull();
    expect(parseSlackWorkspacePlan(undefined)).toBeNull();
  });
});

describe("getSlackWorkspaceChatSystemPrompt", () => {
  const sys = getSlackWorkspaceChatSystemPrompt();

  it("lets the session change the worktrees but not record or publish the change", () => {
    expect(sys).toMatch(/make the change in the worktrees the README declares/);
    expect(sys).toMatch(/no `git commit/);
    expect(sys).toMatch(/gh pr create/);
    expect(sys).not.toMatch(/NEVER edit, create, or delete tracked source files/);
  });

  it("keeps destructive actions forbidden", () => {
    expect(sys).toMatch(/reset --hard/);
  });
});

describe("buildSlackWorkspaceChatPrompt", () => {
  const ws = "/root/workspace/feature-login-20261020";

  it("returns only the message on a resume turn with nothing running", () => {
    expect(buildSlackWorkspaceChatPrompt(ws, "and the api side?", false)).toBe("and the api side?");
  });

  it("makes a turn read-only, resume or not, while an operation runs on the workspace", () => {
    for (const first of [true, false]) {
      const out = buildSlackWorkspaceChatPrompt(ws, "rename it", first, { runningOperation: "autonomous" });
      expect(out).toMatch(/autonomous/);
      expect(out).toMatch(/read-only/);
      expect(out.endsWith("rename it")).toBe(true);
    }
  });

  it("has a new workspace's first turn write the Task heading and Goal the way the task chat does", () => {
    const out = buildSlackWorkspaceChatPrompt(ws, "fix the crash", true, { newWorkspace: true });
    expect(out).toContain(ws);
    expect(out).toMatch(/## Goal/);
    const step = out.match(/rewrite the `# Task:` heading[^\n]*?stays as it is\./)?.[0];
    expect(step).toBeTruthy();
    expect(getTaskChatSystemPrompt()).toContain(step!);
  });

  it("leaves the README alone when a later session reopens the workspace", () => {
    const out = buildSlackWorkspaceChatPrompt(ws, "where were we?", true);
    expect(out).toContain(`${ws}/README.md`);
    expect(out).not.toMatch(/## Goal/);
  });

  it("folds in the thread transcript and memory on the first turn", () => {
    const out = buildSlackWorkspaceChatPrompt(ws, "go", true, {
      threadContext: "alice: the crash is on token expiry",
      memoryDbPath: "/root/.ai-workspace/slack-memory.sqlite",
      userId: "U123",
    });
    expect(out).toContain("the crash is on token expiry");
    expect(out).toContain("user_id='U123'");
  });
});
