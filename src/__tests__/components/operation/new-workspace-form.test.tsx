import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUseRepositories = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/hooks/use-repositories", () => ({
  useRepositories: () => mockUseRepositories(),
}));

import { NewWorkspaceForm } from "@/components/operation/new-workspace-form";

const WEB = { repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" };
const API = { repoPath: "github.com/acme/api", repoName: "api", baseBranch: "master" };

function started(id = "op-1") {
  return { ok: true, json: async () => ({ id }) };
}

beforeEach(() => {
  mockUseRepositories.mockReset().mockReturnValue({
    repositories: [WEB, API],
    isLoading: false,
    error: undefined,
  });
  fetchMock.mockReset().mockResolvedValue(started());
  vi.stubGlobal("fetch", fetchMock);
});

function describeTask(value: string) {
  fireEvent.change(screen.getByLabelText(/task description/i), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /start autonomous/i }));
}

function sentBody(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

describe("NewWorkspaceForm", () => {
  it("folds the ticked repositories into the description the run receives", async () => {
    render(<NewWorkspaceForm />);
    describeTask("Add retry logic to the payment path");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/api/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/operations/autonomous");
    expect(sentBody()).toEqual({
      description:
        "Add retry logic to the payment path\n\n## Selected Repos\n- github.com/acme/api\n- github.com/acme/web",
      startWith: "init",
    });
  });

  it("sends the description untouched when nothing is ticked", async () => {
    render(<NewWorkspaceForm />);
    describeTask("Implement PROJ-123");
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().description).toBe("Implement PROJ-123");
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
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().description).toBe("Add retry logic");
  });

  it("starts with the description handed to it in the URL", () => {
    render(<NewWorkspaceForm initialDescription="from a suggestion" />);
    expect(screen.getByLabelText(/task description/i)).toHaveValue("from a suggestion");
  });

  it("empties the request it just started", async () => {
    render(<NewWorkspaceForm initialDescription="from a suggestion" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    submit();

    await waitFor(() => expect(screen.getByLabelText(/task description/i)).toHaveValue(""));
    expect(screen.getByRole("checkbox", { name: /acme\/web/ })).not.toBeChecked();
  });

  it("takes the next request without a reload", async () => {
    render(<NewWorkspaceForm />);
    describeTask("First task");
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    describeTask("Second task");
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(1).description).toBe("Second task");
  });

  it("keeps the request and reports why when the start was refused", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: "Max 3 concurrent operations" }),
    });
    render(<NewWorkspaceForm />);
    describeTask("Add retry logic");
    fireEvent.click(screen.getByRole("checkbox", { name: /acme\/web/ }));
    submit();

    expect(await screen.findByText(/Max 3 concurrent operations/)).toBeInTheDocument();
    expect(screen.getByLabelText(/task description/i)).toHaveValue("Add retry logic");
    expect(screen.getByRole("checkbox", { name: /acme\/web/ })).toBeChecked();
  });

  it("drops the confirmation once the next request is being typed", async () => {
    render(<NewWorkspaceForm />);
    describeTask("First task");
    submit();

    const note = await screen.findByText(/Recent New Operations/);
    describeTask("Second task");
    expect(note).not.toBeInTheDocument();
  });
});
