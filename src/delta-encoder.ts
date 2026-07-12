import { createHash, randomUUID } from "node:crypto";
import type { DeltaKind, GateInput, PredictedNextState, StructuredDelta, TaskSessionState } from "./types.js";

const acknowledgementPattern = /^(?:ok(?:ay)?|looks? (?:good|fine)|sounds good|got it|thanks?|好的?|可以|没问题|收到)[.!。！\s]*$/i;
const correctionPattern = /(?:\b(wrong|incorrect|not what i asked|you missed|actually|no,|instead)\b|错了|不对|不是这个|漏了|改成|应该是)/i;
const dissatisfactionPattern = /(?:\b(frustrated|annoyed|bad answer|stop doing|not helpful|useless)\b|很失望|不满意|没帮助|别再|太差)/i;
const conflictPattern = /(?:\b(conflicts? with|contradicts?|unsafe|security|compliance)\b|冲突|矛盾|不安全|安全问题|合规)/i;
const constraintPattern = /(?:\b(must|never|do not|don't|required|constraint|non-goal|cannot|should not)\b|必须|绝不|不要|不得|禁止|约束|不能|不应)/i;
const globalPattern = /(?:\b(new goal|change the goal|different task|from scratch|overall|reinterpret|rethink)\b|新目标|换个任务|从头开始|整体重做|重新考虑)/i;
const evidencePattern = /(?:\b(found|according to|evidence|source|result|output|logs?|trace|benchmark|report)\b|证据|来源|结果|输出|日志|追踪|基准|报告)/i;

export class DeltaEncoder {
  encode(input: GateInput, state: TaskSessionState, prediction: PredictedNextState): StructuredDelta {
    const text = input.text.trim();
    const kind = classify(text, input);
    const localEvidence = input.observedToolResult === undefined ? text : serializeToolResult(input.observedToolResult);
    const identity = input.turnId ? `${input.sessionId}:${input.turnId}` : randomUUID();
    return {
      id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
      createdAt: new Date().toISOString(),
      kind,
      summary: summarize(localEvidence, kind, input.observedToolName),
      evidence: extractEvidence(localEvidence),
      affectedFields: affectedFieldsFor(kind, state, prediction),
      estimatedTokens: estimateTokens(localEvidence),
      localEvidence: localEvidence.length > 0 ? localEvidence.slice(0, 1200) : undefined,
      observedToolName: input.observedToolName,
      observedToolResultShape:
        input.observedToolResult === undefined ? undefined : describeResultShape(input.observedToolResult)
    };
  }
}

function classify(text: string, input: GateInput): DeltaKind {
  if (input.observedToolResult !== undefined) return "tool_result";
  if (text.length === 0) return "none";
  if (dissatisfactionPattern.test(text)) return "dissatisfaction";
  if (correctionPattern.test(text)) return "correction";
  if (conflictPattern.test(text)) return "conflict";
  if (globalPattern.test(text)) return "global_goal_change";
  if (constraintPattern.test(text)) return "constraint_change";
  if (evidencePattern.test(text)) return "new_evidence";
  if (acknowledgementPattern.test(text)) return "acknowledgement";
  if (text.endsWith("?") || /\b(clarify|question|what about)\b/i.test(text)) return "clarification";
  return "local_instruction_change";
}

function affectedFieldsFor(
  kind: DeltaKind,
  _state: TaskSessionState,
  prediction: PredictedNextState
): Array<keyof TaskSessionState> {
  switch (kind) {
    case "none":
    case "acknowledgement":
      return [];
    case "clarification":
      return ["open_questions"];
    case "local_instruction_change":
      return ["current_plan"];
    case "global_goal_change":
      return ["user_goal", "current_plan", "open_questions"];
    case "constraint_change":
      return ["hard_constraints", "risk_state"];
    case "new_evidence":
      return ["known_facts", "confidence_state"];
    case "tool_result":
      return ["tool_state", "known_facts"];
    case "correction":
    case "dissatisfaction":
      return ["risk_state", "confidence_state", "current_plan"];
    case "conflict":
      return prediction.expectedAffectedFields.includes("risk_state")
        ? ["risk_state", "known_facts", "hard_constraints"]
        : ["risk_state", "known_facts", "current_plan"];
  }
}

function extractEvidence(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5);
}

function summarize(text: string, kind: DeltaKind, toolName?: string): string {
  if (text.length === 0) return "No material new input.";
  if (kind === "tool_result") {
    return `tool_result${toolName ? ` (${toolName})` : ""}: ${text.replace(/\s+/g, " ").slice(0, 180)}`;
  }
  return `${kind}: ${text.replace(/\s+/g, " ").slice(0, 180)}`;
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable tool result]";
  }
}

function describeResultShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    return `object(${Object.keys(value as Record<string, unknown>).sort().slice(0, 10).join(",")})`;
  }
  return typeof value;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
