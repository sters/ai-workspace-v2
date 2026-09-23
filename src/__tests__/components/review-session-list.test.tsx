import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewSessionList } from "@/components/workspace/review-session-list";
import type { ReviewSession } from "@/types/workspace";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function session(
  timestamp: string,
  overrides: Partial<ReviewSession> = {},
): ReviewSession {
  return {
    timestamp,
    repos: 2,
    critical: 0,
    warnings: 1,
    suggestions: 3,
    ...overrides,
  };
}

const BASE = "/workspace/demo/review";

describe("ReviewSessionList", () => {
  it("links each session to its own route", () => {
    render(
      <ReviewSessionList
        reviews={[session("20260923-140211"), session("20260922-090000")]}
        basePath={BASE}
        activeTimestamp={null}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `${BASE}/20260923-140211`,
      `${BASE}/20260922-090000`,
    ]);
  });

  it("marks only the active session, so the sidebar says which one is open", () => {
    render(
      <ReviewSessionList
        reviews={[session("20260923-140211"), session("20260922-090000")]}
        basePath={BASE}
        activeTimestamp="20260922-090000"
      />,
    );

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", `${BASE}/20260922-090000`);
  });

  it("shows a critical count only when there is one", () => {
    const { rerender } = render(
      <ReviewSessionList
        reviews={[session("20260923-140211", { critical: 0 })]}
        basePath={BASE}
        activeTimestamp={null}
      />,
    );
    expect(screen.queryByText(/critical/)).toBeNull();

    rerender(
      <ReviewSessionList
        reviews={[session("20260923-140211", { critical: 2 })]}
        basePath={BASE}
        activeTimestamp={null}
      />,
    );
    expect(screen.getByText("2 critical")).toBeInTheDocument();
  });
});
