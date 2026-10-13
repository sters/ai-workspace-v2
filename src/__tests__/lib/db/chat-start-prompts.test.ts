// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertChatStartPrompt,
  updateChatStartPrompt,
  deleteChatStartPrompt,
  listChatStartPrompts,
} from "@/lib/db/chat-start-prompts";

describe("db/chat-start-prompts", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("round-trips a prompt's content untouched, newlines included", () => {
    const content = "Look at the failing CI checks first.\nThen propose a fix.";
    insertChatStartPrompt({ title: "CI triage", content });
    expect(listChatStartPrompts().map((p) => [p.title, p.content])).toEqual([["CI triage", content]]);
  });

  it("lists prompts in the order they were created, so the menu does not reshuffle on edit", () => {
    const first = insertChatStartPrompt({ title: "First", content: "a" });
    insertChatStartPrompt({ title: "Second", content: "b" });
    updateChatStartPrompt(first.id, { title: "First (edited)", content: "a2" });
    expect(listChatStartPrompts().map((p) => p.title)).toEqual(["First (edited)", "Second"]);
  });

  it("reports a missing prompt on update and delete", () => {
    expect(updateChatStartPrompt(99999, { title: "X", content: "Y" })).toBeNull();
    expect(deleteChatStartPrompt(99999)).toBe(false);
  });

  it("deletes only the prompt it is given", () => {
    const a = insertChatStartPrompt({ title: "A", content: "a" });
    insertChatStartPrompt({ title: "B", content: "b" });
    expect(deleteChatStartPrompt(a.id)).toBe(true);
    expect(listChatStartPrompts().map((p) => p.title)).toEqual(["B"]);
  });
});
