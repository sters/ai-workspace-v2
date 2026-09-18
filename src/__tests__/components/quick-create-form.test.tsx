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

function fillNote(value: string) {
  fireEvent.change(screen.getByLabelText(/what you want to do/i), { target: { value } });
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
    expect(screen.queryByText(/^feature\//)).not.toBeInTheDocument();

    fillName("Login Crash");

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`feature-login-crash-${stamp}`)).toBeInTheDocument();
    expect(screen.getByText(`feature/login-crash-${stamp}`)).toBeInTheDocument();
  });

  it("warns when the name has nothing ASCII to slug", () => {
    render(<QuickCreateForm />);
    fillName("ログイン時のクラッシュ");

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`feature/workspace-${stamp}`)).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: "bugfix" } });

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`bugfix/retry-${stamp}`)).toBeInTheDocument();
  });

  it("needs something to name the workspace and a repository before it can create", () => {
    render(<QuickCreateForm />);
    const button = screen.getByRole("button", { name: /create workspace/i });
    expect(button).toBeDisabled();

    fillName("login crash");
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    expect(button).toBeEnabled();
  });

  it("takes the note alone, so the name does not have to be typed twice", () => {
    render(<QuickCreateForm />);
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    const button = screen.getByRole("button", { name: /create workspace/i });
    expect(button).toBeDisabled();

    fillNote("Fix the login crash\nthe refresh path 500s");

    expect(button).toBeEnabled();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`feature-fix-the-login-crash-${stamp}`)).toBeInTheDocument();
    expect(screen.getByText("Fix the login crash")).toBeInTheDocument();
  });

  it("lets a typed name override the note for the preview", () => {
    render(<QuickCreateForm />);
    fillNote("Fix the login crash");
    fillName("token refresh");

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(screen.getByText(`feature-token-refresh-${stamp}`)).toBeInTheDocument();
    expect(screen.queryByText(/named from the note/i)).not.toBeInTheDocument();
  });

  it("posts the ticked repositories with the name, type and note", async () => {
    render(<QuickCreateForm />);
    fillName("login crash");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.change(screen.getByLabelText(/task type/i), { target: { value: "bugfix" } });
    fillNote("crash on submit");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(mockPostJson).toHaveBeenCalled());
    expect(mockPostJson).toHaveBeenCalledWith("/api/workspaces", {
      name: "login crash",
      taskType: "bugfix",
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

  it("opens a chat on the new workspace and hands it the note as its task", async () => {
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fillNote("fix the login crash\nthe refresh path 500s");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        "/workspace/bugfix-login-crash-20260911/chat/interactive?task=fix+the+login+crash%0Athe+refresh+path+500s",
      ),
    );
  });

  it("opens the chat with no task when only a name was given", async () => {
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        "/workspace/bugfix-login-crash-20260911/chat/interactive",
      ),
    );
  });

  it("stays put and reports a repository that failed, with the chat still one click away", async () => {
    mockPostJson.mockResolvedValue(
      ok({ problems: [{ repository: "github.com/acme/api", error: "fatal: no such remote" }] }),
    );
    render(<QuickCreateForm />);
    fillName("n");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    fillNote("fix the login crash");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(screen.getByText(/no such remote/)).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /start a chat/i })).toHaveAttribute(
      "href",
      "/workspace/bugfix-login-crash-20260911/chat/interactive?task=fix+the+login+crash",
    );
    expect(screen.getByRole("link", { name: /open the workspace/i })).toHaveAttribute(
      "href",
      "/workspace/bugfix-login-crash-20260911",
    );
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

  describe("a second click never creates a second workspace", () => {
    function ready() {
      render(<QuickCreateForm />);
      fillName("login crash");
      fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
      return screen.getByRole("button", { name: /create workspace/i });
    }

    it("says it is creating while the request is in flight", async () => {
      let settle: (value: unknown) => void = () => {};
      mockPostJson.mockReturnValue(new Promise((resolve) => (settle = resolve)));

      const button = ready();
      fireEvent.click(button);

      await waitFor(() => expect(button).toHaveTextContent(/creating workspace/i));
      expect(button).toBeDisabled();

      settle(ok());
      await waitFor(() => expect(mockPush).toHaveBeenCalled());
    });

    it("stays disabled while the router navigates to the created workspace", async () => {
      const button = ready();
      fireEvent.click(button);
      await waitFor(() => expect(mockPush).toHaveBeenCalled());

      // The form is still mounted until the new route renders, so the click
      // lands here — and a second POST is a second workspace, not a retry.
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mockPostJson).toHaveBeenCalledTimes(1);
    });

    it("stays disabled after a partial failure, since the workspace exists", async () => {
      mockPostJson.mockResolvedValue(
        ok({ problems: [{ repository: "github.com/acme/api", error: "fatal: no such remote" }] }),
      );

      const button = ready();
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/no such remote/)).toBeInTheDocument());

      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mockPostJson).toHaveBeenCalledTimes(1);
    });

    it("stays disabled when the request itself threw, which says nothing either way", async () => {
      mockPostJson.mockRejectedValue(new Error("Failed to fetch"));

      const button = ready();
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/may still have been created/i)).toBeInTheDocument());

      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mockPostJson).toHaveBeenCalledTimes(1);
    });

    it("can be retried once the server refused to create anything", async () => {
      mockPostJson.mockResolvedValue({ ok: false, error: "name is required" });

      const button = ready();
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/name is required/)).toBeInTheDocument());

      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(mockPostJson).toHaveBeenCalledTimes(2));
    });
  });
});
