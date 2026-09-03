import { describe, expect, it } from "vitest";
import {
  getChatSystemPrompt,
  buildInitPrompt,
  getReviewChatSystemPrompt,
  buildReviewChatPrompt,
  getResearchChatSystemPrompt,
  buildResearchChatPrompt,
} from "@/lib/templates/prompts/chat";

describe("getChatSystemPrompt", () => {
  const systemPrompt = getChatSystemPrompt();

  it("spells out the wanted first turn as a positive example", () => {
    // Positive examples steer better than a stack of "Do NOT" lines.
    expect(systemPrompt).toContain('"Ready."');
    expect(systemPrompt).toMatch(/first turn/i);
  });

  it("makes reading the README part of that first turn", () => {
    expect(systemPrompt).toMatch(/one Read call/i);
    expect(systemPrompt).toContain("README.md");
  });

  it("defers reading, analysis and next-step proposals to the user's request", () => {
    expect(systemPrompt).toMatch(/only (once|when|after) the user asks/i);
    expect(systemPrompt.toLowerCase()).toContain("silent reference");
  });

  it("requires a bare cd as the first Bash call", () => {
    expect(systemPrompt).toMatch(/one Bash call/i);
    expect(systemPrompt).toContain("cd");
    expect(systemPrompt).toMatch(/`&&`/);
  });

  it("keeps the negative guidance to a minimum", () => {
    const doNots = systemPrompt.match(/Do NOT/g) ?? [];
    expect(doNots.length).toBeLessThanOrEqual(1);
  });
});

describe.each([
  ["chat", getChatSystemPrompt()],
  ["review chat", getReviewChatSystemPrompt()],
  ["research chat", getResearchChatSystemPrompt()],
])("%s system prompt", (_name, systemPrompt) => {
  it("leaves the TODO files and remaining artifacts to be read on demand", () => {
    // Anything pre-loaded is a snapshot: an operation can rewrite the TODO files
    // and artifacts while the conversation is open.
    expect(systemPrompt).toMatch(/is pre-loaded/i);
    expect(systemPrompt).toMatch(/current state/i);
  });
});

describe.each([
  ["review", getReviewChatSystemPrompt(), "review"],
  ["research", getResearchChatSystemPrompt(), "research"],
])("%s chat system prompt", (_name, systemPrompt, topic) => {
  it("asks for a brief acknowledgement of the topic, then a wait", () => {
    expect(systemPrompt).toMatch(/1-2 sentences/);
    expect(systemPrompt).toContain(`${topic} topic`);
  });

  it("names both the summary and the README as the first turn's reads", () => {
    expect(systemPrompt).toMatch(/Read calls/i);
    expect(systemPrompt).toContain("README.md");
  });

  it("ties further tool use to the user's question rather than forbidding it", () => {
    expect(systemPrompt).toMatch(/once the user's question calls for them/i);
  });

  it("still requires the bare cd first", () => {
    expect(systemPrompt).toMatch(/one Bash call/i);
    expect(systemPrompt).toContain("cd");
  });
});

const workspaceId = "my-project";
const workspacePath = "/root/workspace/my-project";

describe("buildInitPrompt", () => {
  const prompt = buildInitPrompt(workspaceId, workspacePath);

  it("points the first turn at the README instead of embedding it", () => {
    expect(prompt).toContain(`cd ${workspacePath}`);
    expect(prompt).toContain(`${workspacePath}/README.md`);
  });

  it("says where the TODO files and artifacts are without reading them", () => {
    expect(prompt).toContain(`${workspacePath}/TODO-*.md`);
    expect(prompt).toContain(`${workspacePath}/artifacts/`);
  });
});

describe("buildReviewChatPrompt", () => {
  const reviewTimestamp = "20260214-235920";
  const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);

  it("includes the review timestamp and artifacts path", () => {
    expect(prompt).toContain(reviewTimestamp);
    expect(prompt).toContain(`artifacts/reviews/${reviewTimestamp}/`);
  });

  it("names the review SUMMARY.md as a first-turn read", () => {
    expect(prompt).toContain(
      `${workspacePath}/artifacts/reviews/${reviewTimestamp}/SUMMARY.md`,
    );
    expect(prompt).toContain(`${workspacePath}/README.md`);
  });
});

describe("buildResearchChatPrompt", () => {
  const prompt = buildResearchChatPrompt(workspaceId, workspacePath);

  it("names the research summary as a first-turn read", () => {
    expect(prompt).toContain(`${workspacePath}/artifacts/research/summary.md`);
    expect(prompt).toContain(`${workspacePath}/README.md`);
  });

  it("states the topic of the conversation", () => {
    expect(prompt).toContain(workspaceId);
    expect(prompt).toMatch(/research/i);
  });
});

describe.each([
  ["init", () => buildInitPrompt(workspaceId, workspacePath)],
  ["review", () => buildReviewChatPrompt(workspaceId, workspacePath, "20260214-235920")],
  ["research", () => buildResearchChatPrompt(workspaceId, workspacePath)],
])("%s prompt carries no pre-read file content", (_name, build) => {
  it("stays a short set of pointers rather than an embedded corpus", () => {
    // The README body and a TODO progress table used to be inlined here, which
    // both dumped the README into the browser terminal and pinned a snapshot.
    expect(build().length).toBeLessThan(1200);
  });
});
