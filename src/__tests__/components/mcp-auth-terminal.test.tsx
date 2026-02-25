import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OperationEvent } from "@/types/operation";

// Mock xterm.js modules before importing the component
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockFit = vi.fn();

vi.mock("@xterm/xterm", () => {
  return {
    Terminal: class MockTerminal {
      write = mockWrite;
      open = mockOpen;
      dispose = mockDispose;
      loadAddon = mockLoadAddon;
    },
  };
});

vi.mock("@xterm/addon-fit", () => {
  return {
    FitAddon: class MockFitAddon {
      fit = mockFit;
    },
  };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Import after mocks
import { McpAuthTerminal } from "@/components/shared/mcp-auth-terminal";

function makeEvent(
  type: OperationEvent["type"],
  data: string,
): OperationEvent {
  return {
    type,
    operationId: "test-op",
    data,
    timestamp: new Date().toISOString(),
  };
}

const defaultProps = { events: [] as OperationEvent[], isRunning: true };

describe("McpAuthTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders info banner and initializes xterm", async () => {
    render(<McpAuthTerminal {...defaultProps} />);
    expect(
      screen.getByText(/automatically operated by AI/),
    ).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });
  });

  it("filters only terminal events and writes them to xterm", async () => {
    const events: OperationEvent[] = [
      makeEvent("status", "Starting..."),
      makeEvent("terminal", "hello pty"),
      makeEvent("output", '{"type":"result"}'),
      makeEvent("terminal", " world"),
    ];

    const { rerender } = render(<McpAuthTerminal {...defaultProps} />);

    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    rerender(<McpAuthTerminal {...defaultProps} events={events} />);

    expect(mockWrite).toHaveBeenCalledTimes(2);
    expect(mockWrite).toHaveBeenCalledWith("hello pty");
    expect(mockWrite).toHaveBeenCalledWith(" world");
  });

  it("writes only new events on re-render (delta tracking)", async () => {
    const events1: OperationEvent[] = [makeEvent("terminal", "first")];

    const { rerender } = render(<McpAuthTerminal {...defaultProps} />);

    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    rerender(<McpAuthTerminal {...defaultProps} events={events1} />);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith("first");

    const events2: OperationEvent[] = [
      ...events1,
      makeEvent("terminal", "second"),
    ];
    rerender(<McpAuthTerminal {...defaultProps} events={events2} />);

    expect(mockWrite).toHaveBeenCalledTimes(2);
    expect(mockWrite).toHaveBeenLastCalledWith("second");
  });

  it("does not write non-terminal events", async () => {
    const events: OperationEvent[] = [
      makeEvent("status", "status msg"),
      makeEvent("output", "output msg"),
      makeEvent("error", "error msg"),
      makeEvent("complete", '{"exitCode":0}'),
    ];

    const { rerender } = render(<McpAuthTerminal {...defaultProps} />);

    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    rerender(<McpAuthTerminal {...defaultProps} events={events} />);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("shows success message when completed", async () => {
    render(
      <McpAuthTerminal
        events={[makeEvent("terminal", "done")]}
        isRunning={false}
        operationStatus="completed"
      />,
    );
    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });
    expect(
      screen.getByText(/completed successfully/),
    ).toBeInTheDocument();
  });

  it("shows failure message when failed", async () => {
    render(
      <McpAuthTerminal
        events={[makeEvent("terminal", "err")]}
        isRunning={false}
        operationStatus="failed"
      />,
    );
    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it("disposes xterm on unmount", async () => {
    const { unmount } = render(<McpAuthTerminal {...defaultProps} />);

    await vi.waitFor(() => {
      expect(mockOpen).toHaveBeenCalled();
    });

    unmount();
    expect(mockDispose).toHaveBeenCalled();
  });
});
