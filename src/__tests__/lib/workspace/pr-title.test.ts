import { describe, expect, it, vi } from "vitest";
import {
  applyTicketPrefix,
  getSoleCommitSubject,
  resolvePrTitle,
  resolveTicketRef,
  type GitExec,
} from "@/lib/workspace/pr-title";

const git = (out: string, ok = true): GitExec => vi.fn(async () => ({ ok, out }));

describe("resolveTicketRef", () => {
  it.each(["ABC-123", "#42", "acme/web#42"])("accepts the ticket %p", (id) => {
    expect(resolveTicketRef(id)).toBe(id);
  });

  it("drops trailing punctuation", () => {
    expect(resolveTicketRef("ABC-123,")).toBe("ABC-123");
  });

  it.each(["", undefined, "N/A", "https://acme.atlassian.net/browse/ABC-123"])(
    "rejects %p",
    (id) => {
      expect(resolveTicketRef(id)).toBeNull();
    },
  );
});

describe("applyTicketPrefix", () => {
  it.each(["ABC-123", "#42", "acme/web#42"])("prefixes the ticket %p", (id) => {
    expect(applyTicketPrefix("Add pagination", id)).toBe(`[${id}] Add pagination`);
  });

  // The field is whatever a human or `init-readme` put after `**Ticket ID**:`,
  // read as one whitespace-delimited token — so a URL, a prose answer or `N/A`
  // all arrive here and would otherwise be bracketed onto every PR of the task.
  it.each(["N/A", "none", "-", "https://example.atlassian.net/browse/ABC-123", "see"])(
    "adds nothing for %p",
    (id) => {
      expect(applyTicketPrefix("Add pagination", id)).toBe("Add pagination");
    },
  );

  it("adds nothing when there is no ticket", async () => {
    expect(applyTicketPrefix("Add pagination", "")).toBe("Add pagination");
    expect(applyTicketPrefix("Add pagination", undefined)).toBe("Add pagination");
  });

  // Every titled PR opens with `[ID] `, so a subject that already leads with the
  // ticket in another shape has it rewritten rather than bracketed on a second time.
  it.each([
    "[ABC-123] Add pagination",
    "ABC-123: Add pagination",
    "abc-123 - Add pagination",
    "(ABC-123) Add pagination",
    "ABC-123 Add pagination",
  ])("rewrites the leading ticket in %p", (title) => {
    expect(applyTicketPrefix(title, "ABC-123")).toBe("[ABC-123] Add pagination");
  });

  it("brackets the ticket on even when the title names it further in", () => {
    expect(applyTicketPrefix("Fix ABC-123 crash on retry", "ABC-123")).toBe(
      "[ABC-123] Fix ABC-123 crash on retry",
    );
  });

  it("does not take a longer ticket for this one", () => {
    expect(applyTicketPrefix("ABC-1234: Add pagination", "ABC-123")).toBe(
      "[ABC-123] ABC-1234: Add pagination",
    );
  });

  it("tolerates a trailing separator on the field", async () => {
    expect(applyTicketPrefix("Add pagination", "ABC-123,")).toBe("[ABC-123] Add pagination");
  });
});

describe("getSoleCommitSubject", () => {
  it("returns the subject of a branch holding one commit", async () => {
    const exec = git("Add pagination to user search API\n");
    expect(await getSoleCommitSubject("/wt", "main", exec)).toBe("Add pagination to user search API");
    expect(exec).toHaveBeenCalledWith(
      ["log", "--format=%s", "origin/main..HEAD"],
      "/wt",
    );
  });

  // With several commits there is no one subject that describes the branch, so
  // the agent composes instead — which is what it did before this existed.
  it("returns null for a branch holding more than one commit", async () => {
    expect(await getSoleCommitSubject("/wt", "main", git("Second\nFirst\n"))).toBeNull();
  });

  it("returns null for a branch holding no commits", async () => {
    expect(await getSoleCommitSubject("/wt", "main", git("\n"))).toBeNull();
  });

  // `origin/<base>` may not be on disk. Fail closed: a title is composed rather
  // than derived from a range git could not resolve.
  it("returns null when git fails", async () => {
    expect(await getSoleCommitSubject("/wt", "main", git("", false))).toBeNull();
  });

  // A one-commit branch whose commit is a checkpoint says nothing about the
  // change, and the subject becomes the PR title verbatim.
  it.each(["wip", "WIP: pagination", "fixup! Add pagination", "tmp"])(
    "returns null for the checkpoint subject %p",
    async (subject) => {
      expect(await getSoleCommitSubject("/wt", "main", git(`${subject}\n`))).toBeNull();
    },
  );
});

describe("resolvePrTitle", () => {
  it("takes the branch's sole commit subject, ticket bracketed on", async () => {
    expect(
      resolvePrTitle({ ticketId: "ABC-123", soleCommitSubject: "Tweak the search query" }),
    ).toBe("[ABC-123] Tweak the search query");
  });

  it("yields null without a sole commit, leaving the agent to compose from the diff", async () => {
    expect(resolvePrTitle({ ticketId: "ABC-123", soleCommitSubject: null })).toBeNull();
  });
});
