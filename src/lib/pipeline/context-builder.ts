import type { PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { RunClaudeOptions } from "@/types/claude";
import type { ManagedOperation } from "./types";
import { emitEvent, emitStatus } from "./events";
import { wireChild } from "./wire-child";
import { runClaude } from "@/lib/claude";
import { resolveModel } from "@/lib/config";
import { Semaphore } from "@/lib/semaphore";
import { updateOperationWorkspace } from "@/lib/db";

export function buildPhaseFunctionContext(
  managed: ManagedOperation,
  operationId: string,
  phaseIndex: number,
  phaseExtra: { phaseIndex: number; phaseLabel: string },
  appendPhasesFn?: (phases: PipelinePhase[]) => void,
): PhaseFunctionContext {
  const operation = managed.operation;
  let childCounter = 0;

  // Tag native function-phase emissions with childLabel = phaseLabel so they
  // group into a child-group section in the UI, matching how Claude child
  // processes appear (their childLabel is set by wireChild).
  // runChild / runChildGroup keep their own childLabel via wireChild.
  const fnExtra = { ...phaseExtra, childLabel: phaseExtra.phaseLabel };

  return {
    operationId,
    emitStatus: (msg) => emitStatus(managed, msg, fnExtra),
    emitResult: (msg) => {
      emitEvent(managed, {
        type: "output",
        operationId: managed.operation.id,
        data: JSON.stringify({ type: "result", subtype: "success", result: msg }),
        timestamp: new Date().toISOString(),
        ...fnExtra,
      });
    },
    setWorkspace: (ws) => {
      managed.operation.workspace = ws;
      updateOperationWorkspace(managed.operation.id, ws);
      emitStatus(managed, `__setWorkspace:${ws}`, fnExtra);
    },
    emitAsk: (questions, askOptions) => {
      const toolUseId = `fn-ask-${operationId}-${phaseIndex}-${childCounter++}`;
      // Emit an ask event that the UI will render
      emitEvent(managed, {
        type: "output",
        operationId: managed.operation.id,
        data: JSON.stringify({
          type: "assistant",
          message: {
            content: [{
              type: "tool_use",
              id: toolUseId,
              name: "AskUserQuestion",
              input: {
                questions: questions.map((q) => ({
                  question: q.question,
                  options: q.options,
                  multiSelect: q.multiSelect ?? false,
                })),
                allowFreeText: askOptions?.allowFreeText ?? false,
              },
            }],
          },
        }),
        timestamp: new Date().toISOString(),
        ...fnExtra,
      });
      // Return a promise that resolves when the user answers
      // or rejects when the operation is cancelled
      return new Promise<Record<string, string>>((resolve, reject) => {
        const signal = managed.abortController.signal;
        if (signal.aborted) {
          managed.pendingAsks.delete(toolUseId);
          reject(new DOMException("Operation cancelled", "AbortError"));
          return;
        }
        const onAbort = () => {
          managed.pendingAsks.delete(toolUseId);
          reject(new DOMException("Operation cancelled", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        managed.pendingAsks.set(toolUseId, (answers) => {
          signal.removeEventListener("abort", onAbort);
          // Emit a tool_result event so findPendingAsk marks it answered
          emitEvent(managed, {
            type: "output",
            operationId: managed.operation.id,
            data: JSON.stringify({
              type: "user",
              message: {
                content: [{
                  type: "tool_result",
                  tool_use_id: toolUseId,
                  content: Object.values(answers).join(", "),
                }],
              },
            }),
            timestamp: new Date().toISOString(),
            ...fnExtra,
          });
          resolve(answers);
        });
      });
    },
    runChild: async (label, prompt, childOptions) => {
      const cid = `${operationId}-phase-${phaseIndex}-fn-${childCounter++}`;
      (operation.children ??= []).push({ id: cid, label, status: "running" });
      const model = resolveModel(managed.operation.type, childOptions?.stepType, childOptions?.model);
      const claudeOpts: RunClaudeOptions | undefined =
        (childOptions?.jsonSchema || childOptions?.cwd || childOptions?.addDirs || childOptions?.allowedTools || childOptions?.skipAskUserQuestion || childOptions?.appendSystemPromptFile || model)
          ? { jsonSchema: childOptions?.jsonSchema, cwd: childOptions?.cwd, addDirs: childOptions?.addDirs, allowedTools: childOptions?.allowedTools, skipAskUserQuestion: childOptions?.skipAskUserQuestion, appendSystemPromptFile: childOptions?.appendSystemPromptFile, model }
          : undefined;
      const proc = runClaude(cid, prompt, claudeOpts);
      const result = await wireChild(managed, cid, label, proc, phaseExtra);
      if (result.resultText && childOptions?.onResultText) {
        childOptions.onResultText(result.resultText);
      }
      return result.success;
    },
    emitTerminal: (data) => {
      emitEvent(managed, {
        type: "terminal",
        operationId: managed.operation.id,
        data,
        timestamp: new Date().toISOString(),
        ...fnExtra,
      });
    },
    signal: managed.abortController.signal,
    appendPhases: (phases) => {
      if (appendPhasesFn) appendPhasesFn(phases);
    },
    runChildGroup: (children) => {
      const sem = new Semaphore(5);
      const promises = children.map(async (child) => {
        return sem.run(async () => {
          const cid = `${operationId}-phase-${phaseIndex}-fn-${childCounter++}`;
          (operation.children ??= []).push({ id: cid, label: child.label, status: "running" });
          const model = resolveModel(managed.operation.type, child.stepType, child.model);
          const claudeOpts: RunClaudeOptions | undefined =
            (child.cwd || child.addDirs || child.allowedTools || child.jsonSchema || child.skipAskUserQuestion || child.appendSystemPromptFile || model)
              ? { cwd: child.cwd, addDirs: child.addDirs, allowedTools: child.allowedTools, jsonSchema: child.jsonSchema, skipAskUserQuestion: child.skipAskUserQuestion, appendSystemPromptFile: child.appendSystemPromptFile, model }
              : undefined;
          const proc = runClaude(cid, child.prompt, claudeOpts);
          const result = await wireChild(managed, cid, child.label, proc, phaseExtra);
          if (result.resultText && child.onResultText) {
            child.onResultText(result.resultText);
          }
          return result.success;
        });
      });
      return Promise.all(promises);
    },
  };
}
