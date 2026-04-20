// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertSnippet,
  updateSnippet,
  deleteSnippet,
  getSnippet,
  listSnippets,
} from "@/lib/db/snippets";

describe("db/snippets", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("inserts and retrieves a snippet", () => {
    const snippet = insertSnippet({ title: "Auth context", content: "Use OAuth2 with PKCE flow" });

    expect(snippet.id).toBeGreaterThan(0);
    expect(snippet.title).toBe("Auth context");
    expect(snippet.content).toBe("Use OAuth2 with PKCE flow");
    expect(snippet.createdAt).toBeTruthy();
    expect(snippet.updatedAt).toBeTruthy();

    const retrieved = getSnippet(snippet.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Auth context");
  });

  it("lists all snippets ordered by updated_at DESC", () => {
    insertSnippet({ title: "First", content: "Content 1" });
    insertSnippet({ title: "Second", content: "Content 2" });

    const all = listSnippets();
    expect(all).toHaveLength(2);
    // Most recently inserted should be first (latest updated_at)
    expect(all[0].title).toBe("Second");
    expect(all[1].title).toBe("First");
  });

  it("updates a snippet", () => {
    const snippet = insertSnippet({ title: "Old title", content: "Old content" });

    const updated = updateSnippet(snippet.id, { title: "New title", content: "New content" });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("New title");
    expect(updated!.content).toBe("New content");
    expect(updated!.createdAt).toBe(snippet.createdAt);
  });

  it("returns null when updating non-existent snippet", () => {
    const result = updateSnippet(99999, { title: "X", content: "Y" });
    expect(result).toBeNull();
  });

  it("deletes a snippet", () => {
    const snippet = insertSnippet({ title: "To delete", content: "Bye" });
    const ok = deleteSnippet(snippet.id);
    expect(ok).toBe(true);

    const retrieved = getSnippet(snippet.id);
    expect(retrieved).toBeNull();
  });

  it("returns false when deleting non-existent snippet", () => {
    const ok = deleteSnippet(99999);
    expect(ok).toBe(false);
  });

  it("returns null for non-existent snippet", () => {
    const s = getSnippet(99999);
    expect(s).toBeNull();
  });

  it("returns empty list when no snippets exist", () => {
    const all = listSnippets();
    expect(all).toHaveLength(0);
  });
});
