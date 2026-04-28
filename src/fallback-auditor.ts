import type { DecisionRecord, StructuredDelta, TaskSessionState } from "./types.js";

export interface FallbackResult {
  triggered: boolean;
  reason?: string;
}

export class FallbackAuditor {
  audit(state: TaskSessionState, delta: StructuredDelta, correctionLimit: number): FallbackResult {
    const recent = state.gating_history.slice(0, 6);
    const correctionLoops = recent.filter((entry) => entry.deltaKind === "correction" || entry.deltaKind === "dissatisfaction").length;
    if (correctionLoops >= correctionLimit) {
      return { triggered: true, reason: "repeated correction or dissatisfaction loop" };
    }
    if (delta.kind === "dissatisfaction") {
      return { triggered: true, reason: "explicit user dissatisfaction" };
    }
    if (delta.kind === "conflict" && state.risk_state.level !== "low") {
      return { triggered: true, reason: "conflict while risk is already elevated" };
    }
    return { triggered: false };
  }

  labelOutcome(record: DecisionRecord, baselineDecision: string): "true_positive" | "true_negative" | "false_positive" | "false_negative" {
    const conservative = record.gating_decision === "request_full_refresh" || record.gating_decision === "request_partial_refresh";
    const baselineNeedsRefresh = baselineDecision === "request_full_refresh" || baselineDecision === "request_partial_refresh";
    if (conservative && baselineNeedsRefresh) return "true_positive";
    if (!conservative && !baselineNeedsRefresh) return "true_negative";
    return conservative ? "false_positive" : "false_negative";
  }
}
