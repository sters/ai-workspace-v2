import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostGroupTable } from "@/app/utilities/run-costs/cost-group-table";
import type { CostGroup } from "@/lib/run-costs";

const group = (key: string, costUsd: number, runs: number): CostGroup => ({
  key,
  costUsd,
  runs,
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

// Cost and $/run rank these three differently, and "b-step" sorts between the
// others by name, so each order below is distinguishable from the rest.
const groups = [group("a-step", 9, 10), group("c-step", 5, 1), group("b-step", 1, 1)];

const rowKeys = () => screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent);

describe("CostGroupTable", () => {
  it("lists groups by cost, highest first", () => {
    render(<CostGroupTable title="t" groups={groups} total={15} />);
    expect(rowKeys()).toEqual(["a-step", "c-step", "b-step"]);
  });

  it("sorts by a numeric column highest first, and reverses on a second click", () => {
    render(<CostGroupTable title="t" groups={groups} total={15} />);
    fireEvent.click(screen.getByRole("button", { name: /\$\/run/ }));
    expect(rowKeys()).toEqual(["c-step", "b-step", "a-step"]);
    fireEvent.click(screen.getByRole("button", { name: /\$\/run/ }));
    expect(rowKeys()).toEqual(["a-step", "b-step", "c-step"]);
  });

  it("sorts by key alphabetically first", () => {
    render(<CostGroupTable title="t" groups={groups} total={15} />);
    fireEvent.click(screen.getByRole("button", { name: /Key/ }));
    expect(rowKeys()).toEqual(["a-step", "b-step", "c-step"]);
  });

  it("shows a row's detail when an expandable row is clicked, and hides it on a second click", () => {
    render(<CostGroupTable title="t" groups={groups} total={15} expand={(g) => <p>detail of {g.key}</p>} />);
    const row = () => screen.getAllByRole("row").find((r) => r.querySelector("td")?.textContent?.endsWith(" c-step"))!;
    expect(screen.queryByText("detail of c-step")).not.toBeInTheDocument();
    fireEvent.click(row());
    expect(screen.getByText("detail of c-step")).toBeInTheDocument();
    fireEvent.click(row());
    expect(screen.queryByText("detail of c-step")).not.toBeInTheDocument();
  });
});
