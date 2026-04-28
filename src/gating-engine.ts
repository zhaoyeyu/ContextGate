import { resolveConfig } from "./config.js";
import { DeltaEncoder } from "./delta-encoder.js";
import { FallbackAuditor } from "./fallback-auditor.js";
import { ObservabilityLogger } from "./observability.js";
import { Predictor } from "./predictor.js";
import { StateStore } from "./state-store.js";
import { UpdateValuator } from "./update-valuator.js";
import { WorkspaceGate } from "./workspace-gate.js";
import type { DecisionRecord, GateInput, GateResult, GatingDecision, GatingHistoryEntry, PluginConfig, TaskSessionState } from "./types.js";

export class GatingEngine {
  private readonly predictor = new Predictor();
  private readonly encoder = new DeltaEncoder();
  private readonly valuator = new UpdateValuator();
  private readonly gate = new WorkspaceGate();
  private readonly auditor = new FallbackAuditor();
  private readonly logger: ObservabilityLogger;

  constructor(
    private readonly store = new StateStore(),
    private readonly config: PluginConfig = resolveConfig(undefined)
  ) {
    this.logger = new ObservabilityLogger(config.logPath);
  }

  async process(input: GateInput): Promise<GateResult> {
    const taskType = input.taskType ?? this.config.defaultProfile;
    const conversationMode = input.conversationMode ?? "default";
    const state = this.store.getOrCreate(input.sessionId, taskType, conversationMode);
    const confidenceBefore = state.confidence_state.overall;
    const prediction = this.predictor.predict(state);
    const delta = this.encoder.encode(input, state, prediction);
    const valuation = this.valuator.valuate(delta, state, prediction);
    const thresholds = this.config.profiles[taskType];
    const initialDecision = this.config.enabled ? this.gate.decide(state, valuation, thresholds) : "request_full_refresh";
    const fallback = this.auditor.audit(state, delta, this.config.forceFullRefreshAfterCorrections);
    const decision: GatingDecision = fallback.triggered ? "request_full_refresh" : initialDecision;
    const confidenceAfter = updateConfidence(confidenceBefore, decision, valuation.prediction_error, fallback.triggered);

    this.store.applyDelta(state, delta, this.config.maxRecentDeltas);
    const entry: GatingHistoryEntry = {
      turnId: input.turnId ?? delta.id,
      createdAt: delta.createdAt,
      decision,
      reason: fallback.reason ?? decisionReason(decision),
      taskType,
      deltaKind: delta.kind,
      confidenceBefore,
      confidenceAfter,
      fallbackTriggered: fallback.triggered
    };
    this.store.recordHistory(state, entry);

    const record: DecisionRecord = {
      schema_version: "predictive-gating.v1",
      turn_id: entry.turnId,
      session_id: input.sessionId,
      created_at: delta.createdAt,
      estimated_full_context_tokens_avoided: estimateAvoidedTokens(decision, input.fullContextTokenEstimate ?? 0, delta.estimatedTokens),
      gating_decision: decision,
      delta_size: delta.estimatedTokens,
      fallback_triggered: fallback.triggered,
      fallback_reason: fallback.reason,
      task_type: taskType,
      confidence_before: confidenceBefore,
      confidence_after: confidenceAfter,
      valuation,
      delta
    };
    await this.logger.write(record);
    return { decision, state, delta, record, injectedContext: renderInjectedContext(decision, state, record) };
  }

  inspect(sessionId?: string): TaskSessionState | Record<string, TaskSessionState> | undefined {
    return this.store.inspect(sessionId);
  }
}

function updateConfidence(before: number, decision: GatingDecision, predictionError: number, fallbackTriggered: boolean): number {
  if (fallbackTriggered) return Math.max(0, before - 0.25);
  const adjustment = decision === "absorb" ? 0.03 : decision === "inject_delta" ? 0.01 : -0.05;
  return Math.max(0, Math.min(1, before + adjustment - predictionError * 0.08));
}

function estimateAvoidedTokens(decision: GatingDecision, fullContextTokens: number, deltaTokens: number): number {
  if (decision === "request_full_refresh") return 0;
  if (decision === "request_partial_refresh") return Math.max(0, Math.floor(fullContextTokens * 0.4 - deltaTokens));
  return Math.max(0, fullContextTokens - deltaTokens);
}

function decisionReason(decision: GatingDecision): string {
  switch (decision) {
    case "absorb":
      return "input was compressible and low action relevance";
    case "inject_delta":
      return "input changes likely next action locally";
    case "request_partial_refresh":
      return "broader local evidence needed";
    case "request_full_refresh":
      return "risk, conflict, or low confidence requires full context";
  }
}

function renderInjectedContext(decision: GatingDecision, state: TaskSessionState, record: DecisionRecord): string {
  if (decision === "absorb") {
    return `Predictive gating decision: absorb.\nNo action-changing delta detected; unchanged task state remains implicit.\nDelta summary: ${record.delta.summary}`;
  }
  if (decision === "inject_delta") {
    return [
      "Predictive gating decision: inject_delta.",
      `Task type: ${state.task_type}`,
      `Current goal: ${state.user_goal || "(implicit from prior state)"}`,
      `Delta: ${record.delta.summary}`,
      `Affected fields: ${record.delta.affectedFields.join(", ") || "none"}`,
      record.delta.localEvidence ? `Local evidence:\n${record.delta.localEvidence}` : ""
    ].filter(Boolean).join("\n");
  }
  if (decision === "request_partial_refresh") {
    return [
      "Predictive gating decision: request_partial_refresh.",
      "Refresh required evidence around affected state, recent deltas, and risk reasons.",
      `Affected fields: ${record.delta.affectedFields.join(", ") || "none"}`,
      `Risk reasons: ${state.risk_state.reasons.join("; ") || "none"}`
    ].join("\n");
  }
  return "Predictive gating decision: request_full_refresh.\nSend full raw history and current workspace evidence before continuing.";
}
