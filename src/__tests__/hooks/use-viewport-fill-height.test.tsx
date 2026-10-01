import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportFillHeight } from "@/hooks/use-viewport-fill-height";

let rectTop = 0;

function Probe() {
  const { attach, height } = useViewportFillHeight({ bottomGap: 24, minHeight: 320 });
  return (
    <div ref={attach} data-testid="probe" data-height={height ?? "unset"}>
      probe
    </div>
  );
}

function heightOf(): string | null {
  return screen.getByTestId("probe").getAttribute("data-height");
}

beforeEach(() => {
  rectTop = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top: rectTop }) as DOMRect,
  );
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useViewportFillHeight", () => {
  it("reaches from the element's top to the bottom of the viewport, less the gap", () => {
    rectTop = 200;
    render(<Probe />);
    expect(heightOf()).toBe("776");
  });

  it("measures from the document, so being scrolled when it mounts gives the same height", () => {
    rectTop = -100;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    render(<Probe />);
    expect(heightOf()).toBe("776");
  });

  it("does not shrink below the minimum on a short viewport", () => {
    rectTop = 900;
    render(<Probe />);
    expect(heightOf()).toBe("320");
  });

  it("follows a window resize", () => {
    rectTop = 200;
    render(<Probe />);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(heightOf()).toBe("476");
  });
});
