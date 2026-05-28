import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockStartAndNavigate = vi.fn();
const mockUseRunningOperations = vi.fn();

vi.mock("@/hooks/use-running-operations", () => ({
  useRunningOperations: () => mockUseRunningOperations(),
}));

vi.mock("@/hooks/use-start-and-navigate", () => ({
  useStartAndNavigate: () => mockStartAndNavigate,
}));

import { ReadmeUpdater } from "@/components/workspace/readme-updater";

function setRunning(opts: { workspaceRunning?: boolean; updateReadmeRunning?: boolean }) {
  mockUseRunningOperations.mockReturnValue({
    isWorkspaceRunning: () => Boolean(opts.workspaceRunning),
    isWorkspaceTypeRunning: (_ws: string, type: string) =>
      type === "update-readme" ? Boolean(opts.updateReadmeRunning) : false,
  });
}

beforeEach(() => {
  mockStartAndNavigate.mockReset();
});

describe("ReadmeUpdater", () => {
  it("shows the normal Update README button when nothing is running", () => {
    setRunning({});
    render(<ReadmeUpdater workspaceName="ws" workspacePath="/ws/ws" />);
    expect(screen.getByRole("button", { name: /update readme/i })).toBeInTheDocument();
    expect(screen.queryByText(/An operation is currently running/i)).not.toBeInTheDocument();
  });

  it("shows the interject banner and button when another operation is running", () => {
    setRunning({ workspaceRunning: true });
    render(<ReadmeUpdater workspaceName="ws" workspacePath="/ws/ws" />);
    expect(screen.getByText(/An operation is currently running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /interject \+ restart/i })).toBeInTheDocument();
  });

  it("submits with interject=true when in interject mode", () => {
    setRunning({ workspaceRunning: true });
    render(<ReadmeUpdater workspaceName="ws" workspacePath="/ws/ws" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tighten objective" } });
    fireEvent.click(screen.getByRole("button", { name: /interject \+ restart/i }));

    expect(mockStartAndNavigate).toHaveBeenCalledWith(
      "update-readme",
      expect.objectContaining({
        workspace: "/ws/ws",
        instruction: "tighten objective",
        interject: "true",
      }),
    );
  });

  it("submits without interject when nothing is running", () => {
    setRunning({});
    render(<ReadmeUpdater workspaceName="ws" workspacePath="/ws/ws" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "add risks" } });
    fireEvent.click(screen.getByRole("button", { name: /update readme/i }));

    const call = mockStartAndNavigate.mock.calls[0];
    expect(call[0]).toBe("update-readme");
    expect(call[1].interject).toBeUndefined();
    expect(call[1].instruction).toBe("add risks");
  });

  it("disables the form when an update-readme is already running", () => {
    setRunning({ updateReadmeRunning: true });
    render(<ReadmeUpdater workspaceName="ws" workspacePath="/ws/ws" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
