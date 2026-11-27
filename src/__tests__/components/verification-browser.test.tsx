import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "bun:test";
import { stubGlobal } from "@/__tests__/helpers/mocks";
import type { VerificationScenario, VerificationStep } from "@/types/verification";

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockUseScenarios = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("@/lib/router/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/use-workspace", () => ({
  useVerificationScenarios: (...args: unknown[]) => mockUseScenarios(...args),
}));
const mockStart = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/hooks/use-start-and-navigate", () => ({ useStartAndNavigate: () => mockStart }));

import { VerificationBrowser } from "@/components/workspace/verification-browser";

function step(over: Partial<VerificationStep>): VerificationStep {
  return { id: "s", title: "t", actor: "command", command: "true", status: "pending", revision: 0, ...over };
}

function scenario(over: Partial<VerificationScenario>): VerificationScenario {
  return {
    id: "orders",
    title: "Orders list",
    summary: "",
    status: "ready",
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    variables: {},
    steps: [],
    processes: [],
    ...over,
  };
}

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  mockReplace.mockReset();
  mockPush.mockReset();
  mockStart.mockClear();
  fetchMock.mockClear();
  searchParams = new URLSearchParams();
  stubGlobal("fetch", fetchMock);
});

function setScenarios(scenarios: VerificationScenario[]) {
  mockUseScenarios.mockReturnValue({ scenarios, isLoading: false, error: undefined, refresh: vi.fn(async () => {}) });
}

function postedBody(): unknown {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

describe("VerificationBrowser", () => {
  it("lists scenarios and selects one into the URL", () => {
    setScenarios([scenario({}), scenario({ id: "admin", title: "Admin view", status: "failed" })]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByText("Admin view"));
    expect(mockReplace).toHaveBeenCalledWith("/workspace/ws/verify?scenario=admin", { scroll: false });
  });

  it("answers a waiting human step with its inputs, showing the variables in its instructions", async () => {
    setScenarios([scenario({
      status: "waiting",
      variables: { port: "3000" },
      steps: [
        step({ id: "a", title: "Start", status: "passed" }),
        step({
          id: "b",
          actor: "human",
          command: undefined,
          title: "Look",
          status: "waiting",
          instructions: "Open http://localhost:{{port}}/orders",
          inputs: [{ name: "role", label: "Role", options: ["admin", "member"] }],
        }),
      ],
    })]);
    render(<VerificationBrowser workspaceName="ws" />);

    expect(document.body.textContent).toContain("Open http://localhost:3000/orders");
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("Note (what you saw)"), { target: { value: "badge shown" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/workspaces/ws/verification/orders");
    expect(postedBody()).toEqual({ action: "answer", stepId: "b", verdict: "ok", note: "badge shown", values: { role: "admin" } });
  });

  it("opens a chat about a failure from the failed step itself", () => {
    setScenarios([scenario({
      status: "failed",
      steps: [
        step({ id: "a", title: "Start", status: "passed" }),
        step({ id: "b", title: "Call API", status: "failed", result: { at: "2026-01-01T00:00:00.000Z", exitCode: 1, output: "HTTP 500" } }),
      ],
    })]);
    render(<VerificationBrowser workspaceName="ws" />);
    const card = screen.getByText("Call API").closest("li")!;
    const button = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Investigate in chat");
    expect(button).toBeDefined();
    fireEvent.click(button!);
    expect(mockPush).toHaveBeenCalled();
  });

  it("inserts a snippet into the plan's instruction", async () => {
    setScenarios([]);
    fetchMock.mockImplementation(async () =>
      Response.json({ snippets: [{ id: 1, title: "PRRC", content: "verify on the PRRC pod", createdAt: "", updatedAt: "" }] }),
    );
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: "Insert Snippet ▾" }));
    fireEvent.click(await screen.findByText("PRRC"));
    expect((screen.getByPlaceholderText("Optional: what to check, or how to start the app") as HTMLTextAreaElement).value)
      .toBe("verify on the PRRC pod");
    expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])).toContain("/api/snippets?kind=verify");
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
  });

  it("deletes a scenario only once the deletion is confirmed", async () => {
    setScenarios([scenario({})]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workspaces/ws/verification/orders");
    expect(init.method).toBe("DELETE");
  });

  it("reruns a failed scenario from its failed step with the button at the top", async () => {
    setScenarios([scenario({
      status: "failed",
      steps: [
        step({ id: "a", title: "Start", status: "passed" }),
        step({ id: "b", title: "Call API", status: "failed", result: { at: "2026-01-01T00:00:00.000Z", exitCode: 1 } }),
      ],
    })]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: "Rerun from failed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody()).toEqual({ action: "rerun", stepId: "b" });
  });

  it("starts a replan from the failed step itself", () => {
    setScenarios([scenario({
      status: "failed",
      steps: [step({ id: "b", title: "Call API", status: "failed", result: { at: "2026-01-01T00:00:00.000Z", exitCode: 1 } })],
    })]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: "Replan from failed" }));
    expect(mockStart).toHaveBeenCalledWith("plan-verification", { workspace: "ws", scenarioId: "orders" });
  });

  it("offers a replan of a passed scenario, which says it rewrites every step", () => {
    setScenarios([scenario({ status: "passed", steps: [step({ id: "a", title: "Call", status: "passed" })] })]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: "Replan" }));
    expect(document.body.textContent).toContain("Claude rewrites every step");
  });

  it("edits only the unfinished steps and saves them in their new order", async () => {
    setScenarios([scenario({
      status: "failed",
      steps: [
        step({ id: "a", title: "Seed", status: "passed" }),
        step({ id: "b", title: "Call", status: "failed", result: { at: "2026-01-01T00:00:00.000Z", exitCode: 1 } }),
        step({ id: "c", title: "Check", command: "test 1 = 1" }),
      ],
    })]);
    render(<VerificationBrowser workspaceName="ws" />);
    fireEvent.click(screen.getByRole("button", { name: /Edit steps/ }));

    expect(screen.queryByDisplayValue("Seed")).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Move up")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody()).toEqual({
      action: "edit",
      steps: [
        { title: "Check", actor: "command", command: "test 1 = 1" },
        { title: "Call", actor: "command", command: "true" },
      ],
    });
  });
});
