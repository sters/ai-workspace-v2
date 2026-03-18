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

export interface SubagentOutputState {
  content: string;
  loading: boolean;
  error: boolean;
}
