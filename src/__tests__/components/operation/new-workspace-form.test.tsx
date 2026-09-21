import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUseRepositories = vi.fn();
const mockUseOperation = vi.fn();
const mockStart = vi.fn();

vi.mock("@/hooks/use-repositories", () => ({
  useRepositories: () => mockUseRepositories(),
}));

vi.mock("@/hooks/use-operation", () => ({
  useOperation: (...args: unknown[]) => mockUseOperation(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { NewWorkspaceForm } from "@/components/operation/new-workspace-form";

const WEB = { repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" };
const API = { repoPath: "github.com/acme/api", repoName: "api", baseBranch: "master" };

beforeEach(() => {
  mockStart.mockReset();
  mockUseRepositories.mockReset().mockReturnValue({
    repositories: [WEB, API],
    isLoading: false,
    error: undefined,
  });
  mockUseOperation.mockReset().mockReturnValue({
    operation: null,
    events: [],
    connected: true,
    isRunning: false,
    start: mockStart,
    cancel: vi.fn(),
    reset: vi.fn(),
  });
});

function describeTask(value: string) {
  fireEvent.change(screen.getByLabelText(/task description/i), { target: { value } });
}

describe("NewWorkspaceForm", () => {
  it("folds the ticked repositories into the description the run receives", async () => {
    render(<NewWorkspaceForm />);
    describeTask("Add retry logic to the payment path");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/api/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole("button", { name: /start autonomous/i }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart).toHaveBeenCalledWith("autonomous", {
      description:
        "Add retry logic to the payment path\n\n## Selected Repos\n- github.com/acme/api\n- github.com/acme/web",
      interactionLevel: "mid",
      startWith: "init",
    });
  });

  it("sends the description untouched when nothing is ticked", async () => {
    render(<NewWorkspaceForm />);
    describeTask("Implement PROJ-123");
    fireEvent.click(screen.getByRole("button", { name: /start autonomous/i }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart.mock.calls[0][1].description).toBe("Implement PROJ-123");
  });

  it("will not start on ticked repositories alone", () => {
    render(<NewWorkspaceForm />);
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));

    expect(screen.getByRole("button", { name: /start autonomous/i })).toBeDisabled();
  });

  it("unticking a repository takes it back out of the description", async () => {
    render(<NewWorkspaceForm />);
    describeTask("Add retry logic");
    const web = screen.getByRole("checkbox", { name: /acme\/web/ });
    fireEvent.click(web);
    fireEvent.click(web);
    fireEvent.click(screen.getByRole("button", { name: /start autonomous/i }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart.mock.calls[0][1].description).toBe("Add retry logic");
  });

  it("starts with the description handed to it in the URL", () => {
    render(<NewWorkspaceForm initialDescription="from a suggestion" />);
    expect(screen.getByLabelText(/task description/i)).toHaveValue("from a suggestion");
  });
});
