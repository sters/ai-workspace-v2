import { describe, expect, it, vi } from "vitest";
import {
  applyTicketPrefix,
  getSoleCommitSubject,
  resolvePrTitle,
  resolveTaskTitle,
  type GitExec,
} from "@/lib/workspace/pr-title";

const git = (out: string, ok = true): GitExec => vi.fn(() => ({ ok, out }));

describe("resolveTaskTitle", () => {
  it("takes the README heading as written", () => {
    expect(resolveTaskTitle("Add pagination to user search API")).toBe(
      "Add pagination to user search API",
    );
  });

  // A README `init-readme` never rewrote still carries the template's `TBD`, and
  // `parseReadmeMeta` reports a missing heading as `Untitled`. Mandating either
  // would put it on every PR of the task.
  it.each(["TBD", "tbd", "Untitled", "  ", ""])("rejects the placeholder %p", (title) => {
    expect(resolveTaskTitle(title)).toBeNull();
  });
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

  it("adds nothing when there is no ticket", () => {
    expect(applyTicketPrefix("Add pagination", "")).toBe("Add pagination");
    expect(applyTicketPrefix("Add pagination", undefined)).toBe("Add pagination");
  });

  // The heading, or the commit subject, may already name the ticket.
  it("does not name the ticket twice", () => {
    expect(applyTicketPrefix("[ABC-123] Add pagination", "ABC-123")).toBe(
      "[ABC-123] Add pagination",
    );
    expect(applyTicketPrefix("Fix abc-123 crash on retry", "ABC-123")).toBe(
      "Fix abc-123 crash on retry",
    );
  });

  it("tolerates a trailing separator on the field", () => {
    expect(applyTicketPrefix("Add pagination", "ABC-123,")).toBe("[ABC-123] Add pagination");
  });
});

describe("getSoleCommitSubject", () => {
  it("returns the subject of a branch holding one commit", () => {
    const exec = git("Add pagination to user search API\n");
    expect(getSoleCommitSubject("/wt", "main", exec)).toBe("Add pagination to user search API");
    expect(exec).toHaveBeenCalledWith(
      ["log", "--format=%s", "origin/main..HEAD"],
      "/wt",
    );
  });

  // With several commits there is no one subject that describes the branch, so
  // the agent composes instead — which is what it did before this existed.
  it("returns null for a branch holding more than one commit", () => {
    expect(getSoleCommitSubject("/wt", "main", git("Second\nFirst\n"))).toBeNull();
  });

  it("returns null for a branch holding no commits", () => {
    expect(getSoleCommitSubject("/wt", "main", git("\n"))).toBeNull();
  });

  // `origin/<base>` may not be on disk. Fail closed: a title is composed rather
  // than derived from a range git could not resolve.
  it("returns null when git fails", () => {
    expect(getSoleCommitSubject("/wt", "main", git("", false))).toBeNull();
  });

  // A one-commit branch whose commit is a checkpoint says nothing about the
  // change, and the subject becomes the PR title verbatim.
  it.each(["wip", "WIP: pagination", "fixup! Add pagination", "tmp"])(
    "returns null for the checkpoint subject %p",
    (subject) => {
      expect(getSoleCommitSubject("/wt", "main", git(`${subject}\n`))).toBeNull();
    },
  );
});

describe("resolvePrTitle", () => {
  it("prefers the task title over the branch's sole commit", () => {
    expect(
      resolvePrTitle({
        taskTitle: "Add pagination to user search API",
        ticketId: "ABC-123",
        soleCommitSubject: "Tweak the search query",
      }),
    ).toBe("[ABC-123] Add pagination to user search API");
  });

  // The task title is what makes sibling PRs match, so the commit subject is
  // only reached when there is none — and then each repo's title is its own.
  it("falls back to the sole commit subject", () => {
    expect(
      resolvePrTitle({
        taskTitle: null,
        ticketId: "ABC-123",
        soleCommitSubject: "Tweak the search query",
      }),
    ).toBe("[ABC-123] Tweak the search query");
  });

  it("yields null when neither is available", () => {
    expect(resolvePrTitle({ taskTitle: null, ticketId: "ABC-123", soleCommitSubject: null }))
      .toBeNull();
  });
});
