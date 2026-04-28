import { createHash } from "node:crypto";
import type { DeltaKind, GateInput, PredictedNextState, StructuredDelta, TaskSessionState } from "./types.js";

const correctionPattern = /\b(wrong|incorrect|not what i asked|fix that|you missed|actually|no,|instead)\b/i;
const dissatisfactionPattern = /\b(frustrated|annoyed|bad answer|stop doing|not helpful|useless)\b/i;
const conflictPattern = /\b(conflicts? with|contradicts?|regression|breaks?|fails?|unsafe|security|compliance)\b/i;
const constraintPattern = /\b(must|never|do not|don't|required|constraint|non-goal|cannot|should not)\b/i;
const globalPattern = /\b(new goal|change the goal|different task|from scratch|overall|reinterpret|rethink)\b/i;
const evidencePattern = /\b(found|according to|evidence|source|result|output|logs?|trace|benchmark|report)\b/i;

export class DeltaEncoder {
  encode(input: GateInput, state: TaskSessionState, prediction: PredictedNextState): StructuredDelta {
    const text = input.text.trim();
    const kind = classify(text, input);
    return {
      id: createHash("sha256").update(`${input.sessionId}:${text}:${Date.now()}`).digest("hex").slice(0, 16),
      createdAt: new Date().toISOString(),
      kind,
      summary: summarize(text, kind),
      evidence: extractEvidence(text),
      affectedFields: affectedFieldsFor(kind, state, prediction),
      estimatedTokens: estimateTokens(text),
      localEvidence: text.length > 0 ? text.slice(0, 1200) : undefined
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

function summarize(text: string, kind: DeltaKind): string {
  if (text.length === 0) return "No material new input.";
  return `${kind}: ${text.replace(/\s+/g, " ").slice(0, 180)}`;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
