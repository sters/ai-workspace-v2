import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoLesson } from "@/types/repo-lessons";
import { RepoLessonsBrowser } from "@/components/utilities/repo-lessons-browser";

function lesson(overrides: Partial<RepoLesson>): RepoLesson {
  return {
    id: "l1",
    repoKey: "github.com/acme/widgets",
    section: "implementation",
    text: "Regenerate the client after changing `schema.sql`.",
    status: "candidate",
    evidence: [{ workspace: "feature-orders", note: "A person regenerated it", url: "https://example.com/c/1" }],
    challenges: [],
    replaces: [],
    sourceWorkspace: "feature-orders",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

const lessons = [
  lesson({ id: "c1", text: "Candidate in widgets" }),
  lesson({ id: "c2", repoKey: "github.com/acme/gadgets", text: "Candidate in gadgets" }),
  lesson({ id: "a1", status: "approved", text: "Approved in widgets" }),
  lesson({ id: "r1", status: "rejected", text: "Rejected in gadgets", repoKey: "github.com/acme/gadgets" }),
  lesson({ id: "s1", status: "superseded", text: "Superseded in widgets" }),
];

describe("RepoLessonsBrowser", () => {
  it("shows only candidates first, with a count on each status tab", () => {
    render(<RepoLessonsBrowser lessons={lessons} onChanged={vi.fn()} />);
    expect(screen.queryByText("Approved in widgets")).not.toBeInTheDocument();
    expect(screen.queryByText("Rejected in gadgets")).not.toBeInTheDocument();
    expect(screen.queryByText("Superseded in widgets")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Candidates\s*2/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Approved\s*1/ })).toBeInTheDocument();
  });

  it("shows one repository at a time, picked from the list", async () => {
    render(<RepoLessonsBrowser lessons={lessons} onChanged={vi.fn()} />);
    expect(screen.getByText("Candidate in gadgets")).toBeInTheDocument();
    expect(screen.queryByText("Candidate in widgets")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /github\.com\/acme\/widgets/ }));
    expect(screen.getByText("Candidate in widgets")).toBeInTheDocument();
    expect(screen.queryByText("Candidate in gadgets")).not.toBeInTheDocument();
  });

  it("lists only repositories with lessons in the selected status, keeping a valid selection", async () => {
    render(<RepoLessonsBrowser lessons={lessons} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /github\.com\/acme\/widgets/ }));
    await userEvent.click(screen.getByRole("tab", { name: /Rejected/ }));
    expect(screen.getByText("Rejected in gadgets")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /github\.com\/acme\/widgets/ })).not.toBeInTheDocument();
  });

  it("opens on approved when there are no candidates", () => {
    render(<RepoLessonsBrowser lessons={[lesson({ id: "a1", status: "approved", text: "Only approved" })]} onChanged={vi.fn()} />);
    expect(screen.getByText("Only approved")).toBeInTheDocument();
  });

  it("renders inline code in the lesson text and keeps evidence collapsed", () => {
    render(<RepoLessonsBrowser lessons={[lesson({})]} onChanged={vi.fn()} />);
    expect(screen.getByText("schema.sql").tagName).toBe("CODE");
    const details = screen.getByText(/Evidence \(1\)/).closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(within(details!).getByText(/A person regenerated it/)).toBeInTheDocument();
  });

  it("lists disputed approved lessons first and lets a person keep one", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RepoLessonsBrowser
        lessons={[
          lesson({ id: "a1", status: "approved", text: "Undisputed" }),
          lesson({ id: "a2", status: "approved", text: "Disputed one", challenges: [{ workspace: "fix-orders", note: "Reviewer undid it" }] }),
        ]}
        onChanged={onChanged}
      />,
    );
    const rows = screen.getAllByRole("listitem").filter((li) => li.querySelector("button"));
    expect(within(rows[0]).getByText("Disputed one")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Reviewer undid it")).toBeVisible();
    expect(within(rows[1]).queryByRole("button", { name: "Keep" })).not.toBeInTheDocument();

    await userEvent.click(within(rows[0]).getByRole("button", { name: "Keep" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dismissChallenges: true });
    expect(onChanged).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
