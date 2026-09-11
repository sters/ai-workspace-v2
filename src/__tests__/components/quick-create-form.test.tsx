import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUseRepositories = vi.fn();
const mockPostJson = vi.fn();
const mockPush = vi.fn();

vi.mock("@/hooks/use-repositories", () => ({
  useRepositories: () => mockUseRepositories(),
}));

vi.mock("@/lib/api", () => ({
  postJson: (...a: unknown[]) => mockPostJson(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { QuickCreateForm } from "@/components/operation/quick-create-form";

function setRepositories(repos: { repoPath: string; repoName: string; baseBranch: string }[]) {
  mockUseRepositories.mockReturnValue({
    repositories: repos,
    isLoading: false,
    error: undefined,
  });
}

const WEB = { repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" };
const API = { repoPath: "github.com/acme/api", repoName: "api", baseBranch: "master" };

function ok(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    data: {
      workspace: "bugfix-login-crash-20260911",
      workspacePath: "/ws/bugfix-login-crash-20260911",
      repositories: [{ repoPath: WEB.repoPath, repoName: "web", branchName: "bugfix/login-crash", baseBranch: "main", worktreePath: "/ws/x" }],
      problems: [],
      log: [],
      ...overrides,
    },
  };
}

function fillName(value: string) {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value } });
}

beforeEach(() => {
  mockUseRepositories.mockReset();
  mockPostJson.mockReset().mockResolvedValue(ok());
  mockPush.mockReset();
  setRepositories([WEB, API]);
});

describe("QuickCreateForm", () => {
  it("lists each cloned repository with the base branch it would branch from", () => {
    render(<QuickCreateForm />);

    expect(screen.getByRole("checkbox", { name: /github\.com\/acme\/web/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /github\.com\/acme\/api/ })).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("master")).toBeInTheDocument();
  });

  it("previews the directory and branch the name will produce", () => {
    render(<QuickCreateForm />);
    expect(screen.queryByText(/^bugfix\//)).not.toBeInTheDocument();

    fillName("Login Crash");

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`bugfix-login-crash-${stamp}`)).toBeInTheDocument();
    expect(screen.getByText(`bugfix/login-crash-${stamp}`)).toBeInTheDocument();
  });

  it("warns when the name has nothing ASCII to slug", () => {
    render(<QuickCreateForm />);
    fillName("ログイン時のクラッシュ");

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`bugfix/workspace-${stamp}`)).toBeInTheDocument();
    expect(screen.getByText(/nothing that survives/i)).toBeInTheDocument();
  });

  it("does not warn about a name that asked for `workspace`", () => {
    render(<QuickCreateForm />);
    fillName("workspace tidy up");
    expect(screen.queryByText(/nothing that survives/i)).not.toBeInTheDocument();
  });

  it("follows the task type into the preview", () => {
    render(<QuickCreateForm />);
    fillName("retry");
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: "feature" } });

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`feature/retry-${stamp}`)).toBeInTheDocument();
  });

  it("needs both a name and a repository before it can create", () => {
    render(<QuickCreateForm />);
    const button = screen.getByRole("button", { name: /create workspace/i });
    expect(button).toBeDisabled();

    fillName("login crash");
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    expect(button).toBeEnabled();
  });

  it("posts the ticked repositories with the name, type and note", async () => {
    render(<QuickCreateForm />);
    fillName("login crash");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: "feature" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "crash on submit" } });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(mockPostJson).toHaveBeenCalled());
    expect(mockPostJson).toHaveBeenCalledWith("/api/workspaces", {
      name: "login crash",
      taskType: "feature",
      repositories: ["github.com/acme/web"],
      note: "crash on submit",
    });
  });

  it("adds a repository that is not cloned yet from the free-text field", async () => {
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.change(screen.getByLabelText(/add repository/i), {
      target: { value: " github.com/acme/infra  github.com/acme/tools " },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(mockPostJson).toHaveBeenCalled());
    expect(mockPostJson.mock.calls[0][1].repositories).toEqual([
      "github.com/acme/infra",
      "github.com/acme/tools",
    ]);
  });

  it("opens the new workspace when every worktree was created", async () => {
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/workspace/bugfix-login-crash-20260911"),
    );
  });

  it("stays put and reports a repository that failed", async () => {
    mockPostJson.mockResolvedValue(
      ok({ problems: [{ repository: "github.com/acme/api", error: "fatal: no such remote" }] }),
    );
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(screen.getByText(/no such remote/)).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: /bugfix-login-crash-20260911/ }),
    ).toHaveAttribute("href", "/workspace/bugfix-login-crash-20260911");
  });

  it("reports a rejected request without claiming a workspace exists", async () => {
    mockPostJson.mockResolvedValue({ ok: false, error: "name is required" });
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(screen.getByText(/name is required/)).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
