import type { PredictedNextState, TaskSessionState } from "./types.js";

export class Predictor {
  predict(state: TaskSessionState): PredictedNextState {
    switch (state.task_type) {
      case "workflow_local_delta":
        return {
          expectedDeltaKinds: ["clarification", "local_instruction_change", "tool_result"],
          expectedAffectedFields: ["current_plan", "tool_state", "open_questions"],
          expectedNextAction: "continue current workflow with local adjustment",
          confidence: bounded(state.confidence_state.predictionReliability + 0.1)
        };
      case "coding_iterative":
        return {
          expectedDeltaKinds: ["tool_result", "local_instruction_change", "correction"],
          expectedAffectedFields: ["tool_state", "known_facts", "current_plan", "risk_state"],
          expectedToolResultShape: state.tool_state.lastToolResultShape,
          expectedNextAction: "apply or verify a localized code change",
          confidence: state.confidence_state.predictionReliability
        };
      case "research_global_reinterpretation":
        return {
          expectedDeltaKinds: ["new_evidence", "conflict", "global_goal_change"],
          expectedAffectedFields: ["known_facts", "risk_state", "user_goal", "current_plan"],
          expectedNextAction: "reconsider global interpretation against evidence",
          confidence: bounded(state.confidence_state.predictionReliability - 0.15)
        };
      case "safety_critical":
        return {
          expectedDeltaKinds: ["constraint_change", "conflict", "correction", "new_evidence"],
          expectedAffectedFields: ["hard_constraints", "risk_state", "known_facts", "open_questions"],
          expectedNextAction: "refresh context before taking consequential action",
          confidence: bounded(state.confidence_state.predictionReliability - 0.25)
        };
    }
  }
}

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}
