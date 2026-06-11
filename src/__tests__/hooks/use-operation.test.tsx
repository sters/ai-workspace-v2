import { renderHook } from "@testing-library/react";
import { useOperation } from "@/hooks/use-operation";
import type { OperationListItem } from "@/types/operation";

const STORAGE_PREFIX = "aiw-op:";
const STORAGE_KEY = "init";

const runningOp: OperationListItem = {
  id: "op-1",
  type: "init",
  workspace: "",
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("useOperation localStorage hydration safety", () => {
  beforeEach(() => {
    localStorage.clear();
    // SSE fetch should never resolve so the restored operation stays put.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders null on the first render (matching SSR) even when localStorage holds a running operation, then restores after mount", () => {
    localStorage.setItem(
      `${STORAGE_PREFIX}${STORAGE_KEY}`,
      JSON.stringify(runningOp),
    );

    const renders: (OperationListItem | null)[] = [];
    const { result } = renderHook(() => {
      const r = useOperation(STORAGE_KEY);
      renders.push(r.operation);
      return r;
    });

    // First render must match what the server produced (no window/localStorage).
    expect(renders[0]).toBeNull();
    // After effects flush, the persisted operation is restored.
    expect(result.current.operation?.id).toBe("op-1");
  });

  it("does not erase the persisted operation before the post-mount restore runs", () => {
    localStorage.setItem(
      `${STORAGE_PREFIX}${STORAGE_KEY}`,
      JSON.stringify(runningOp),
    );

    renderHook(() => useOperation(STORAGE_KEY));

    // The persist effect must not clobber localStorage during the null first render.
    expect(localStorage.getItem(`${STORAGE_PREFIX}${STORAGE_KEY}`)).not.toBeNull();
  });

  it("drops completed operations from localStorage on restore", () => {
    localStorage.setItem(
      `${STORAGE_PREFIX}${STORAGE_KEY}`,
      JSON.stringify({ ...runningOp, status: "completed" }),
    );

    const { result } = renderHook(() => useOperation(STORAGE_KEY));

    expect(result.current.operation).toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}${STORAGE_KEY}`)).toBeNull();
  });
});
