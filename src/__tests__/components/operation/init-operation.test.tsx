import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OperationListItem } from "@/types/operation";

const mockUseOperation = vi.fn();
const mockPush = vi.fn();

vi.mock("@/hooks/use-operation", () => ({
  useOperation: (...args: unknown[]) => mockUseOperation(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

import { InitOperation } from "@/components/operation/init-operation";

function setOperation(operation: OperationListItem | null) {
  mockUseOperation.mockReturnValue({
    operation,
    events: [],
    connected: true,
    isRunning: operation?.status === "running",
    start: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  });
}

const RUNNING: OperationListItem = {
  id: "op-1",
  type: "autonomous",
  workspace: "feature-login-crash-20260918",
  status: "running",
  startedAt: "2026-09-18T00:00:00.000Z",
};

beforeEach(() => {
  mockUseOperation.mockReset();
  mockPush.mockReset();
  setOperation(null);
});

function renderInit() {
  return render(
    <InitOperation>{({ started }) => <p>{started ? "started" : "idle"}</p>}</InitOperation>,
  );
}

describe("InitOperation", () => {
  it("links to the workspace it created instead of navigating there", () => {
    setOperation(RUNNING);
    renderInit();

    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: /feature-login-crash-20260918/ }),
    ).toHaveAttribute("href", "/workspace/feature-login-crash-20260918/operations");
  });

  it("says nothing about a workspace before the run has named one", () => {
    setOperation({ ...RUNNING, workspace: "" });
    renderInit();

    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("keeps no record of the run, so returning to the page starts clean", () => {
    renderInit();

    // A storage key is what made an in-flight init reappear on this page, which
    // only existed to carry the navigation that is now gone.
    expect(mockUseOperation).toHaveBeenCalledWith(undefined, undefined);
  });
});
