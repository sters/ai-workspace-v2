import { renderHook, act } from "@testing-library/react";
import { useAsyncCallback } from "@/hooks/use-async-callback";

describe("useAsyncCallback", () => {
  it("calls the sync callback and pending stays false", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useAsyncCallback(fn));

    expect(result.current[1]).toBe(false);
    act(() => result.current[0]());
    expect(fn).toHaveBeenCalledOnce();
    expect(result.current[1]).toBe(false);
  });

  it("sets pending=true while async callback is in-flight", async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => promise);
    const { result } = renderHook(() => useAsyncCallback(fn));

    act(() => result.current[0]());
    expect(fn).toHaveBeenCalledOnce();
    expect(result.current[1]).toBe(true);

    await act(async () => resolve());
    expect(result.current[1]).toBe(false);
  });

  it("blocks duplicate calls while pending", async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => promise);
    const { result } = renderHook(() => useAsyncCallback(fn));

    act(() => result.current[0]());
    act(() => result.current[0]()); // should be ignored
    expect(fn).toHaveBeenCalledOnce();

    await act(async () => resolve());
    expect(result.current[1]).toBe(false);
  });

  it("does nothing when fn is undefined", () => {
    const { result } = renderHook(() => useAsyncCallback(undefined));
    expect(result.current[1]).toBe(false);
    act(() => result.current[0]()); // should not throw
    expect(result.current[1]).toBe(false);
  });

  it("passes arguments through", () => {
    const fn = vi.fn((_a: number, _b: string) => {});
    const { result } = renderHook(() => useAsyncCallback(fn));

    act(() => result.current[0](42, "hello"));
    expect(fn).toHaveBeenCalledWith(42, "hello");
  });

  it("resets pending even if promise rejects", async () => {
    let reject!: (err: Error) => void;
    const promise = new Promise<void>((_r, rej) => {
      reject = rej;
    });
    // Catch the rejection so it doesn't become unhandled
    promise.catch(() => {});
    const fn = vi.fn(() => promise);
    const { result } = renderHook(() => useAsyncCallback(fn));

    act(() => result.current[0]());
    expect(result.current[1]).toBe(true);

    await act(async () => reject(new Error("fail")));
    expect(result.current[1]).toBe(false);
  });
});
