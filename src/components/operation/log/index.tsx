"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import type { OperationPhaseInfo } from "@/types/operation";
import type { OperationLogProps } from "@/types/components";
import { parseStreamEvent, enrichPermissionDenials } from "@/lib/parsers/stream";
import type { LogEntry } from "@/types/claude";
import { buildDisplayNodes, groupByChildLabel, groupByPhase, findPendingAsk } from "./display-nodes";
import { ChildGroupSection, SubAgentSection, PhaseGroupSection } from "./sections";
import { EntryRow } from "./entries";
import { AskInput } from "./ask-input";
import { PhaseTabBar } from "./phase-tab-bar";

export function OperationLog({
  operationId,
  events,
  isRunning,
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
    return enrichPermissionDenials(result);
  }, [events]);

  // Derive live phase statuses from __phaseUpdate events in the stream
  const livePhases = useMemo(() => {
    const phaseMap = new Map<number, OperationPhaseInfo>();

    for (const entry of entries) {
      if (entry.kind === "system" && entry.content.startsWith("__phaseUpdate:")) {
        try {
          const data = JSON.parse(entry.content.slice("__phaseUpdate:".length));
          const idx = data.phaseIndex as number;
          const existing = phaseMap.get(idx);
          if (existing) {
            existing.status = data.phaseStatus;
          } else {
            phaseMap.set(idx, {
              index: idx,
              label: data.phaseLabel ?? `Phase ${idx + 1}`,
              status: data.phaseStatus,
            });
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    if (phaseMap.size === 0) return undefined;
    return Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
  }, [entries]);

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
    const grouped = groupByChildLabel(buildDisplayNodes(cleanEntries));
    // In "all" view with multiple phases, group nodes into phase sections
    if (activePhaseTab === "all" && livePhases && livePhases.length > 1) {
      return groupByPhase(grouped);
    }
    return grouped;
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
            node.type === "phase-group" ? (
              <PhaseGroupSection key={`phase-${node.phaseIndex}`} group={node} />
            ) : node.type === "entry" ? (
              <EntryRow key={i} entry={node.entry} />
            ) : node.type === "subagent" ? (
              <SubAgentSection key={node.toolUseId} group={node} />
            ) : node.type === "child-group" ? (
              <ChildGroupSection key={node.label} group={node} />
            ) : null
          )}
        </div>
      </div>

      {pendingAsk && (
        <AskInput
          operationId={operationId}
          toolUseId={pendingAsk.toolId}
          questions={pendingAsk.questions}
          allowFreeText={pendingAsk.allowFreeText}
        />
      )}
    </div>
  );
}
