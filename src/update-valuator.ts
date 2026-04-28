import type { PredictedNextState, StructuredDelta, TaskSessionState, Valuation } from "./types.js";

export class UpdateValuator {
  valuate(delta: StructuredDelta, state: TaskSessionState, prediction: PredictedNextState): Valuation {
    return {
      prediction_error: prediction.expectedDeltaKinds.includes(delta.kind) ? 0.15 : 0.7,
      action_relevance: actionRelevance(delta),
      risk_delta: riskDelta(delta, state),
      novelty: novelty(delta, state),
      conflict: conflictScore(delta),
      compressibility: compressibility(delta)
    };
  }
}

function actionRelevance(delta: StructuredDelta): number {
  switch (delta.kind) {
    case "none":
      return 0;
    case "clarification":
      return 0.25;
    case "local_instruction_change":
    case "tool_result":
      return 0.55;
    case "new_evidence":
      return 0.65;
    case "constraint_change":
      return 0.8;
    case "global_goal_change":
    case "correction":
    case "dissatisfaction":
    case "conflict":
      return 0.9;
  }
}

function riskDelta(delta: StructuredDelta, state: TaskSessionState): number {
  const base = state.risk_state.level === "critical" ? 0.9 : state.risk_state.level === "high" ? 0.65 : 0.2;
  switch (delta.kind) {
    case "constraint_change":
    case "conflict":
      return Math.max(base, 0.75);
    case "correction":
    case "dissatisfaction":
      return Math.max(base, 0.65);
    case "global_goal_change":
      return Math.max(base, 0.55);
    case "none":
    case "clarification":
    case "local_instruction_change":
    case "new_evidence":
    case "tool_result":
      return base;
  }
}

function novelty(delta: StructuredDelta, state: TaskSessionState): number {
  const previous = state.recent_deltas.find((item) => item.summary === delta.summary || item.localEvidence === delta.localEvidence);
  return previous ? 0.1 : Math.min(1, 0.35 + delta.affectedFields.length * 0.15);
}

function conflictScore(delta: StructuredDelta): number {
  return delta.kind === "conflict" ? 0.9 : delta.kind === "correction" || delta.kind === "dissatisfaction" ? 0.65 : 0.1;
}

function compressibility(delta: StructuredDelta): number {
  if (delta.kind === "none") return 1;
  const evidenceLength = delta.evidence.join(" ").length;
  const sourceLength = delta.localEvidence?.length ?? evidenceLength;
  if (sourceLength === 0) return 1;
  return Math.max(0, Math.min(1, 1 - evidenceLength / Math.max(sourceLength, 1)));
}
