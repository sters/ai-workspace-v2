// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertSuggestion,
  listActiveSuggestions,
  dismissSuggestion,
  getSuggestion,
  _resetSuggestionStatements,
} from "@/lib/db/suggestions";

describe("db/suggestions", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    // Force DB creation (runs migrations)
    getDb();
  });

  it("inserts and retrieves a suggestion", () => {
    insertSuggestion({
      id: "s1",
      sourceWorkspace: "ws-1",
      sourceOperationId: "op-1",
      title: "Fix auth flow",
      description: "Auth needs rework",
    });

    const s = getSuggestion("s1");
    expect(s).not.toBeNull();
    expect(s!.id).toBe("s1");
    expect(s!.sourceWorkspace).toBe("ws-1");
    expect(s!.sourceOperationId).toBe("op-1");
    expect(s!.title).toBe("Fix auth flow");
    expect(s!.description).toBe("Auth needs rework");
    expect(s!.dismissed).toBe(false);
    expect(s!.createdAt).toBeTruthy();
  });

  it("lists active (non-dismissed) suggestions", () => {
    insertSuggestion({
      id: "s1",
      sourceWorkspace: "ws-1",
      sourceOperationId: "op-1",
      title: "Title 1",
      description: "Desc 1",
    });
    insertSuggestion({
      id: "s2",
      sourceWorkspace: "ws-1",
      sourceOperationId: "op-2",
      title: "Title 2",
      description: "Desc 2",
    });

    const active = listActiveSuggestions();
    expect(active).toHaveLength(2);
  });

  it("dismisses a suggestion and excludes it from active list", () => {
    insertSuggestion({
      id: "s1",
      sourceWorkspace: "ws-1",
      sourceOperationId: "op-1",
      title: "Title 1",
      description: "Desc 1",
    });

    const ok = dismissSuggestion("s1");
    expect(ok).toBe(true);

    const active = listActiveSuggestions();
    expect(active).toHaveLength(0);

    const dismissed = getSuggestion("s1");
    expect(dismissed).not.toBeNull();
    expect(dismissed!.dismissed).toBe(true);
  });

  it("returns false when dismissing non-existent suggestion", () => {
    const ok = dismissSuggestion("nonexistent");
    expect(ok).toBe(false);
  });

  it("returns null for non-existent suggestion", () => {
    const s = getSuggestion("nonexistent");
    expect(s).toBeNull();
  });
});
