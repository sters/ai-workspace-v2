"use client";

import type { OperationPhaseInfo } from "@/types/operation";
import { Button } from "../../shared/buttons/button";
import { statusTextColors, statusIcons } from "@/lib/status-styles";

export function PhaseTabBar({
  phases,
  activeTab,
  onTabClick,
}: {
  phases: OperationPhaseInfo[];
  activeTab: number | "all";
  onTabClick: (tab: number | "all") => void;
}) {

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/30 p-1.5">
      <Button
        variant="ghost-toggle"
        onClick={() => onTabClick("all")}
        className={`rounded-md px-2.5 py-1 text-left text-xs font-medium transition-colors ${
          activeTab === "all"
            ? "bg-background text-foreground shadow-sm"
            : "hover:bg-background/50"
        }`}
      >
        All phases
      </Button>
      {phases.map((phase) => (
        <Button
          variant="ghost-toggle"
          key={phase.index}
          onClick={() => onTabClick(phase.index)}
          className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-left text-xs font-medium transition-colors ${
            activeTab === phase.index
              ? "bg-background text-foreground shadow-sm"
              : "hover:bg-background/50"
          }`}
        >
          <span className={`shrink-0 ${statusTextColors[phase.status]} ${phase.status === "running" ? "animate-pulse" : ""}`}>
            {statusIcons[phase.status]}
          </span>
          <span>Phase {phase.index + 1}: {phase.label}</span>
        </Button>
      ))}
    </div>
  );
}
