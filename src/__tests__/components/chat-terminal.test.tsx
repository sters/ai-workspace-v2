import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const openSession = vi.fn();

vi.mock("@/hooks/use-chat-session", () => ({
  useChatSession: () => ({
    containerRef: { current: null },
    state: "idle",
    exitCode: null,
    error: null,
    openSession,
    continueSlackThread: vi.fn(),
    cancelResume: vi.fn(),
    stopSession: vi.fn(),
  }),
}));

vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key === "/api/chat-start-prompts"
      ? { prompts: [{ id: 1, title: "Saved", content: "Saved prompt" }] }
      : undefined,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ChatTerminal } from "@/components/workspace/chat-terminal";

function centerStartButton() {
  return screen.getAllByRole("button", { name: "Start Chat" }).at(-1)!;
}

describe("ChatTerminal opening message", () => {
  beforeEach(() => openSession.mockReset());

  it("starts a session whose opening message is the typed text", () => {
    render(<ChatTerminal workspaceId="ws" />);
    fireEvent.change(screen.getByPlaceholderText(/first message/i), { target: { value: "  fix the login bug  " } });
    fireEvent.click(centerStartButton());
    expect(openSession).toHaveBeenCalledWith("fix the login bug");
  });

  it("opens the plain chat when nothing is typed", () => {
    render(<ChatTerminal workspaceId="ws" />);
    fireEvent.change(screen.getByPlaceholderText(/first message/i), { target: { value: "   " } });
    fireEvent.click(centerStartButton());
    expect(openSession).toHaveBeenCalledWith(undefined);
  });

  it("appends the typed text to a saved start prompt picked from the menu", () => {
    render(<ChatTerminal workspaceId="ws" />);
    fireEvent.change(screen.getByPlaceholderText(/first message/i), { target: { value: "on the orders page" } });
    const toggles = screen.getAllByRole("button", { name: "More options" });
    fireEvent.click(toggles.at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Saved" }));
    expect(openSession).toHaveBeenCalledWith("Saved prompt\n\non the orders page");
  });
});
