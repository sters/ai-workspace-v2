export interface UseTerminalOptions {
  readonly?: boolean;
  webLinks?: boolean;
  /**
   * Called with the fitted size after init and after every layout change that
   * moved it. Consumers backed by a PTY forward this so the child process is
   * told its viewport changed.
   */
  onResize?: (cols: number, rows: number) => void;
}

export interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  termRef: React.MutableRefObject<any | null>;
  init: () => Promise<void>;
  dispose: () => void;
}

export interface SubagentOutputState {
  content: string;
  loading: boolean;
  error: boolean;
}
