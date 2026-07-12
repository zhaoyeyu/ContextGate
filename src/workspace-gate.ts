import type { GatingDecision, ProfileThresholds, TaskSessionState, Valuation } from "./types.js";

export interface PolicyRecommendation {
  decision: GatingDecision;
  matchedRule: string;
  reason: string;
}

export class WorkspaceGate {
  decide(state: TaskSessionState, valuation: Valuation, thresholds: ProfileThresholds): GatingDecision {
    return this.evaluate(state, valuation, thresholds).decision;
  }

  evaluate(state: TaskSessionState, valuation: Valuation, thresholds: ProfileThresholds): PolicyRecommendation {
    if (state.confidence_state.overall < thresholds.minConfidenceToGate) {
      return recommendation("request_full_refresh", "confidence_floor", "state confidence is below the profile floor");
    }
    if (valuation.risk_delta >= thresholds.fullRefreshRisk || valuation.conflict >= thresholds.fullRefreshConflict) {
      return recommendation("request_full_refresh", "full_refresh_boundary", "risk or conflict crossed a full-refresh boundary");
    }
    if (valuation.conflict >= thresholds.partialRefreshConflict) {
      return recommendation("request_partial_refresh", "partial_refresh_conflict", "conflict requires broader supporting context");
    }
    if (
      valuation.action_relevance <= thresholds.absorbMaxActionRelevance &&
      valuation.prediction_error <= thresholds.absorbMaxPredictionError &&
      valuation.novelty <= 0.2 &&
      valuation.compressibility >= 0.45
    ) {
      return recommendation("absorb", "low_value_update", "the update is predictable, low-impact, and contains no novel state");
    }
    if (valuation.risk_delta <= thresholds.injectMaxRiskDelta) {
      return recommendation("inject_delta", "bounded_local_delta", "the update is locally relevant and remains inside the risk boundary");
    }
    return recommendation("request_partial_refresh", "risk_precaution", "risk is too high for delta-only injection");
  }
}

function recommendation(decision: GatingDecision, matchedRule: string, reason: string): PolicyRecommendation {
  return { decision, matchedRule, reason };
}
