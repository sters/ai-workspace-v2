"use client";

import { useRef, useEffect, useCallback } from "react";

export const TERMINAL_THEME = {
  background: "#1a1b26",
  foreground: "#a9b1d6",
  cursor: "#c0caf5",
  selectionBackground: "#33467c",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
} as const;

export interface UseTerminalOptions {
  readonly?: boolean;
  webLinks?: boolean;
}

export interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  termRef: React.MutableRefObject<any | null>;
  init: () => Promise<void>;
  dispose: () => void;
}

export function useTerminal(options?: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);

  const dispose = useCallback(() => {
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitAddonRef.current = null;
  }, []);

  const init = useCallback(async () => {
    dispose();

    if (!containerRef.current) return;

    const imports: [
      typeof import("@xterm/xterm"),
      typeof import("@xterm/addon-fit"),
      (typeof import("@xterm/addon-web-links") | null),
    ] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      options?.webLinks ? import("@xterm/addon-web-links") : Promise.resolve(null),
    ]);

    const [{ Terminal }, { FitAddon }, webLinksModule] = imports;

    if (!containerRef.current) return;

    // Clear any residual DOM from a previous xterm instance
    containerRef.current.innerHTML = "";

    const isReadonly = options?.readonly ?? false;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    const theme = isReadonly
      ? { ...TERMINAL_THEME, cursor: TERMINAL_THEME.background }
      : TERMINAL_THEME;

    const term = new Terminal({
      cursorBlink: !isReadonly,
      ...(isReadonly && {
        cursorInactiveStyle: "none" as const,
        disableStdin: true,
      }),
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme,
    });

    term.loadAddon(fitAddon);

    if (webLinksModule) {
      term.loadAddon(new webLinksModule.WebLinksAddon());
    }

    term.open(containerRef.current);
    termRef.current = term;

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during transitions
      }
    });
  }, [options?.readonly, options?.webLinks, dispose]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore fit errors during transitions
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Auto-dispose on unmount
  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  return { containerRef, termRef, init, dispose };
}
