import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock xterm.js modules before importing the hook
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockFit = vi.fn();
const mockFocus = vi.fn();

vi.mock("@xterm/xterm", () => {
  return {
    Terminal: vi.fn().mockImplementation(function () {
      return {
        write: mockWrite,
        open: mockOpen,
        dispose: mockDispose,
        loadAddon: mockLoadAddon,
        focus: mockFocus,
        cols: 97,
        rows: 31,
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

  it("init() fits before returning, so callers read the fitted size", async () => {
    const { result } = renderHook(() => useTerminal());

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    // Callers (chat start message, claude-usage request) read term.cols right
    // after awaiting init(), so the fit cannot be deferred to a later frame.
    expect(mockFit).toHaveBeenCalled();
    expect(result.current.termRef.current.cols).toBe(97);
  });

  it("reports the fitted size to onResize", async () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => useTerminal({ onResize }));

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });

    expect(onResize).toHaveBeenCalledWith(97, 31);
  });

  it("does not re-report a size that has not changed", async () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => useTerminal({ onResize }));

    const container = document.createElement("div");
    Object.defineProperty(result.current.containerRef, "current", {
      value: container,
      writable: true,
    });

    await act(async () => {
      await result.current.init();
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(onResize).toHaveBeenCalledTimes(1);
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
  describe("focusOnWindowFocus", () => {
    async function initWith(options: Parameters<typeof useTerminal>[0]) {
      const hook = renderHook(() => useTerminal(options));
      const container = document.createElement("div");
      document.body.appendChild(container);
      Object.defineProperty(hook.result.current.containerRef, "current", {
        value: container,
        writable: true,
      });
      await act(async () => {
        await hook.result.current.init();
      });
      return { ...hook, container };
    }

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("focuses the terminal when the window regains focus", async () => {
      await initWith({ focusOnWindowFocus: true });

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(mockFocus).toHaveBeenCalledTimes(1);
    });

    it("leaves focus alone when not asked to", async () => {
      await initWith({});

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(mockFocus).not.toHaveBeenCalled();
    });

    it("does not take focus from a text field outside the terminal", async () => {
      await initWith({ focusOnWindowFocus: true });
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(mockFocus).not.toHaveBeenCalled();
    });

    it("takes focus back from a button", async () => {
      await initWith({ focusOnWindowFocus: true });
      const button = document.createElement("button");
      document.body.appendChild(button);
      button.focus();

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(mockFocus).toHaveBeenCalledTimes(1);
    });

    it("stops listening once unmounted", async () => {
      const { unmount } = await initWith({ focusOnWindowFocus: true });
      unmount();

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(mockFocus).not.toHaveBeenCalled();
    });
  });
});
