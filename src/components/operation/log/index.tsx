"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { OperationEvent, OperationPhaseInfo } from "@/types/operation";
import { parseStreamEvent } from "@/lib/parsers/stream";
import type { LogEntry } from "@/types/claude";
import { buildDisplayNodes, groupByChildLabel, findPendingAsk } from "./display-nodes";
import { ChildGroupSection, SubAgentSection } from "./sections";
import { EntryRow } from "./entries";
import { AskInput } from "./ask-input";

interface OperationLogProps {
  operationId: string;
  events: OperationEvent[];
  isRunning: boolean;
  phases?: OperationPhaseInfo[];
}

export function OperationLog({
  operationId,
  events,
  isRunning,
  phases: initialPhases,
}: OperationLogProps) {
  const [activePhaseTab, setActivePhaseTab] = useState<number | "all">("all");
  const userSelectedTabRef = useRef(false);

  const entries = useMemo(() => {
    const result: LogEntry[] = [];
    for (const event of events) {
      if (event.type === "output") {
        const parsed = parseStreamEvent(event.data);
        for (const entry of parsed) {
          if (event.childLabel) entry.childLabel = event.childLabel;
          if (event.phaseIndex != null) entry.phaseIndex = event.phaseIndex;
          if (event.phaseLabel) entry.phaseLabel = event.phaseLabel;
        }
        result.push(...parsed);
      } else if (event.type === "error") {
        result.push({
          kind: "error",
          content: event.data,
          childLabel: event.childLabel,
          phaseIndex: event.phaseIndex,
          phaseLabel: event.phaseLabel,
        });
      } else if (event.type === "complete") {
        try {
          const d = JSON.parse(event.data);
          result.push({
            kind: "complete",
            exitCode: d.exitCode ?? -1,
            childLabel: event.childLabel,
            phaseIndex: event.phaseIndex,
            phaseLabel: event.phaseLabel,
          });
        } catch {
          result.push({
            kind: "complete",
            exitCode: -1,
            childLabel: event.childLabel,
            phaseIndex: event.phaseIndex,
            phaseLabel: event.phaseLabel,
          });
        }
      } else if (event.type === "status") {
        result.push({
          kind: "system",
          content: event.data,
          childLabel: event.childLabel,
          phaseIndex: event.phaseIndex,
          phaseLabel: event.phaseLabel,
        });
      }
    }
    return result;
  }, [events]);

  // Derive live phase statuses from __phaseUpdate events
  const livePhases = useMemo(() => {
    if (!initialPhases || initialPhases.length === 0) return undefined;

    const phaseMap = new Map<number, OperationPhaseInfo>();
    for (const p of initialPhases) {
      phaseMap.set(p.index, { ...p });
    }

    for (const entry of entries) {
      if (entry.kind === "system" && entry.content.startsWith("__phaseUpdate:")) {
        try {
          const data = JSON.parse(entry.content.slice("__phaseUpdate:".length));
          const existing = phaseMap.get(data.phaseIndex);
          if (existing) {
            existing.status = data.phaseStatus;
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    return Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
  }, [initialPhases, entries]);

  // Auto-switch to the latest running phase (unless user manually selected a tab)
  useEffect(() => {
    if (!livePhases || userSelectedTabRef.current) return;
    const running = livePhases.filter((p) => p.status === "running");
    if (running.length > 0) {
      setActivePhaseTab(running[running.length - 1].index);
    }
  }, [livePhases]);

  // Filter entries by phase when a specific tab is selected
  const filteredEntries = useMemo(() => {
    if (activePhaseTab === "all" || !livePhases) return entries;
    return entries.filter((e) => {
      // __phaseUpdate system entries are meta — hide them in filtered views
      if (e.kind === "system" && e.content.startsWith("__phaseUpdate:")) return false;
      // Pipeline-level complete events (no phaseIndex) should not leak into individual phase tabs
      if (e.phaseIndex == null) return e.kind !== "complete";
      return e.phaseIndex === activePhaseTab;
    });
  }, [entries, activePhaseTab, livePhases]);

  // Build display nodes: group sub-agent entries under their parent Task tool_use_id,
  // then group by childLabel for operation groups/pipelines.
  const nodes = useMemo(() => {
    // In "all" view, filter out __phaseUpdate meta entries for cleaner display
    const cleanEntries = activePhaseTab === "all" && livePhases
      ? entries.filter((e) => !(e.kind === "system" && e.content.startsWith("__phaseUpdate:")))
      : filteredEntries;
    return groupByChildLabel(buildDisplayNodes(cleanEntries));
  }, [entries, filteredEntries, activePhaseTab, livePhases]);


  if (events.length === 0) {
    return null;
  }

  // Find the latest unanswered ask entry — always scan all entries to avoid missing prompts
  const pendingAsk = isRunning ? findPendingAsk(entries) : null;

  const handleTabClick = (tab: number | "all") => {
    userSelectedTabRef.current = tab !== "all";
    setActivePhaseTab(tab);
  };

  return (
    <div className="space-y-2">
      {livePhases && livePhases.length > 0 && (
        <PhaseTabBar
          phases={livePhases}
          activeTab={activePhaseTab}
          onTabClick={handleTabClick}
        />
      )}

      <div
        className="max-h-[500px] overflow-y-auto overflow-x-hidden rounded-lg border bg-card p-3 text-sm"
      >
        <div className="space-y-1.5">
          {nodes.map((node, i) =>
            node.type === "entry" ? (
              <EntryRow key={i} entry={node.entry} />
            ) : node.type === "subagent" ? (
              <SubAgentSection key={node.toolUseId} group={node} />
            ) : (
              <ChildGroupSection key={node.label} group={node} />
            )
          )}
        </div>
      </div>

      {pendingAsk && (
        <AskInput
          operationId={operationId}
          toolUseId={pendingAsk.toolId}
          questions={pendingAsk.questions}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseTabBar
// ---------------------------------------------------------------------------

function PhaseTabBar({
  phases,
  activeTab,
  onTabClick,
}: {
  phases: OperationPhaseInfo[];
  activeTab: number | "all";
  onTabClick: (tab: number | "all") => void;
}) {
  const statusIcon: Record<OperationPhaseInfo["status"], string> = {
    pending: "\u25CB",    // ○
    running: "\u25CF",    // ●
    completed: "\u2713",  // ✓
    failed: "\u2717",     // ✗
    skipped: "\u2014",    // —
  };

  const statusColor: Record<OperationPhaseInfo["status"], string> = {
    pending: "text-muted-foreground",
    running: "text-blue-500",
    completed: "text-green-600",
    failed: "text-red-500",
    skipped: "text-muted-foreground/50",
  };

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/30 p-1.5">
      <button
        onClick={() => onTabClick("all")}
        className={`rounded-md px-2.5 py-1 text-left text-xs font-medium transition-colors ${
          activeTab === "all"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        }`}
      >
        All phases
      </button>
      {phases.map((phase) => (
        <button
          key={phase.index}
          onClick={() => onTabClick(phase.index)}
          className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-left text-xs font-medium transition-colors ${
            activeTab === phase.index
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          }`}
        >
          <span className={`shrink-0 ${statusColor[phase.status]} ${phase.status === "running" ? "animate-pulse" : ""}`}>
            {statusIcon[phase.status]}
          </span>
          <span>Phase {phase.index + 1}: {phase.label}</span>
        </button>
      ))}
    </div>
  );
}
