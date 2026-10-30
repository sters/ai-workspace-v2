import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OperationListItem } from "@/types/operation";
import { OperationSummary } from "@/components/operation/operation-summary";

const NOW = new Date("2026-10-29T09:00:00Z").getTime();

function running(extra: Partial<OperationListItem> = {}): OperationListItem {
  return {
    id: "op-1",
    type: "autonomous",
    workspace: "ws-1",
    status: "running",
    startedAt: new Date(NOW - 60_000).toISOString(),
    currentPhase: {
      index: 0,
      label: "Cycle 1: Execute",
      status: "running",
      timeoutMs: 10 * 60_000,
      startedAt: new Date(NOW - 60_000).toISOString(),
    },
    ...extra,
  };
}

describe("OperationSummary — usage limit wait", () => {
  it("shows the operation as waiting until the reset, without a timeout bar", () => {
    const until = new Date(NOW + 30 * 60_000);
    render(<OperationSummary operation={running({ usageLimitWaitUntil: until.toISOString() })} now={NOW} />);

    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText(/usage limit/i).textContent).toContain(until.toLocaleTimeString());
    expect(screen.queryByText(/Timeout:/)).toBeNull();
  });

  it("shows a running operation as running", () => {
    render(<OperationSummary operation={running()} now={NOW} />);

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText(/usage limit/i)).toBeNull();
    expect(screen.getByText(/Timeout:/)).toBeInTheDocument();
  });
});
