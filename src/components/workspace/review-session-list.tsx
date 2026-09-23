"use client";

import Link from "next/link";
import { Card } from "../shared/containers/card";
import { cn, formatReviewTimestamp } from "@/lib/utils";
import type { ReviewSession } from "@/types/workspace";

/**
 * The workspace's review sessions, newest first, as a sidebar.
 *
 * One row per session rather than a wrapping row of cards: a workspace's
 * autonomous run writes a session per cycle, so the set grows down a column
 * where it used to push the report being read off the screen.
 */
export function ReviewSessionList({
  reviews,
  basePath,
  activeTimestamp,
}: {
  reviews: ReviewSession[];
  basePath: string;
  activeTimestamp: string | null;
}) {
  return (
    <Card variant="flush" className="h-fit overflow-hidden py-1">
      <nav aria-label="Review sessions">
        <ul className="text-sm">
          {reviews.map((r) => {
            const isActive = activeTimestamp === r.timestamp;
            return (
              <li key={r.timestamp}>
                <Link
                  href={`${basePath}/${r.timestamp}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "block px-3 py-2 transition-colors hover:bg-accent",
                    isActive && "bg-accent",
                  )}
                >
                  <div className="whitespace-nowrap font-medium">
                    {formatReviewTimestamp(r.timestamp)}
                  </div>
                  {/* One line, never wrapped: the column takes its width from
                      this row, so a wrap would make it narrower than its own
                      content. */}
                  <div className="mt-0.5 flex gap-x-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <span>{r.repos} repos</span>
                    {r.critical > 0 && (
                      <span className="text-red-500">{r.critical} critical</span>
                    )}
                    <span>{r.warnings} warn</span>
                    <span>{r.suggestions} suggest</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Card>
  );
}
