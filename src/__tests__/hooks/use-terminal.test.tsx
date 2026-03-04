import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock xterm.js modules before importing the hook
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockFit = vi.fn();

vi.mock("@xterm/xterm", () => {
  return {
    Terminal: vi.fn().mockImplementation(function () {
      return {
        write: mockWrite,
        open: mockOpen,
        dispose: mockDispose,
        loadAddon: mockLoadAddon,
      };
    }),
  };
});

vi.mock("@xterm/addon-fit", () => {
  return {
    FitAddon: vi.fn().mockImplementation(function () {
      return { fit: mockFit };
    }),
  };
});

vi.mock("@xterm/addon-web-links", () => {
  return {
    WebLinksAddon: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Import after mocks
import { useTerminal } from "@/hooks/use-terminal";
import { Terminal } from "@xterm/xterm";

describe("useTerminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns containerRef, termRef, init, and dispose", () => {
    const { result } = renderHook(() => useTerminal());
    expect(result.current.containerRef).toBeDefined();
    expect(result.current.termRef).toBeDefined();
    expect(result.current.init).toBeInstanceOf(Function);
    expect(result.current.dispose).toBeInstanceOf(Function);
  });

  it("default options: cursorBlink true, stdin enabled", async () => {
    const { result } = renderHook(() => useTerminal());

    // Attach a container element to the ref
    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorBlink: true,
      }),
    );
    // disableStdin should not be set (or false)
    const opts = vi.mocked(Terminal).mock.calls[0][0];
    expect(opts?.disableStdin).toBeFalsy();
  });

  it("readonly: true sets disableStdin, cursorBlink false, cursorInactiveStyle none", async () => {
    const { result } = renderHook(() => useTerminal({ readonly: true }));

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        disableStdin: true,
        cursorBlink: false,
        cursorInactiveStyle: "none",
      }),
    );
  });

  it("webLinks: true loads WebLinksAddon", async () => {
    const { result } = renderHook(() => useTerminal({ webLinks: true }));

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    // FitAddon + WebLinksAddon = 2 loadAddon calls
    expect(mockLoadAddon).toHaveBeenCalledTimes(2);
  });

  it("without webLinks only loads FitAddon", async () => {
    const { result } = renderHook(() => useTerminal());

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    // Only FitAddon
    expect(mockLoadAddon).toHaveBeenCalledTimes(1);
  });

  it("init() opens terminal on the container", async () => {
    const { result } = renderHook(() => useTerminal());

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    expect(mockOpen).toHaveBeenCalledWith(container);
    expect(result.current.termRef.current).toBeTruthy();
  });

  it("dispose() calls Terminal.dispose and clears refs", async () => {
    const { result } = renderHook(() => useTerminal());

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    expect(result.current.termRef.current).toBeTruthy();

    act(() => {
      result.current.dispose();
    });

    expect(mockDispose).toHaveBeenCalled();
    expect(result.current.termRef.current).toBeNull();
  });

  it("auto-disposes on unmount", async () => {
    const { result, unmount } = renderHook(() => useTerminal());

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });

  it("readonly: true hides cursor by setting cursor color to background", async () => {
    const { result } = renderHook(() => useTerminal({ readonly: true }));

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    const opts = vi.mocked(Terminal).mock.calls[0][0];
    // For readonly, cursor color matches background to hide it
    expect(opts?.theme?.cursor).toBe(opts?.theme?.background);
  });
});
