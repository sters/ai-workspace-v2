import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/shared/feedback/spinner";

describe("Spinner", () => {
  // The a11y contract, not the animation: loading UI is found by role elsewhere.
  it("exposes itself as a labelled status region", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
