import type { GatingDecision, ProfileThresholds, TaskSessionState, Valuation } from "./types.js";

export class WorkspaceGate {
  decide(state: TaskSessionState, valuation: Valuation, thresholds: ProfileThresholds): GatingDecision {
    if (state.confidence_state.overall < thresholds.minConfidenceToGate) {
      return "request_full_refresh";
    }
    if (valuation.risk_delta >= thresholds.fullRefreshRisk || valuation.conflict >= thresholds.fullRefreshConflict) {
      return "request_full_refresh";
    }
    if (valuation.conflict >= thresholds.partialRefreshConflict) {
      return "request_partial_refresh";
    }
    if (
      valuation.action_relevance <= thresholds.absorbMaxActionRelevance &&
      valuation.prediction_error <= thresholds.absorbMaxPredictionError &&
      valuation.compressibility >= 0.45
    ) {
      return "absorb";
    }
    if (valuation.risk_delta <= thresholds.injectMaxRiskDelta) {
      return "inject_delta";
    }
    return "request_partial_refresh";
  }
}
