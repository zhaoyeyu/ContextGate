export type TaskType =
  | "workflow_local_delta"
  | "coding_iterative"
  | "research_global_reinterpretation"
  | "safety_critical";

export type ConversationMode = "default" | "review" | "planning" | "execution" | "debug";
export type GatingDecision = "absorb" | "inject_delta" | "request_partial_refresh" | "request_full_refresh";

export type DeltaKind =
  | "none"
  | "clarification"
  | "local_instruction_change"
  | "global_goal_change"
  | "constraint_change"
  | "new_evidence"
  | "tool_result"
  | "correction"
  | "dissatisfaction"
  | "conflict";

export interface ConfidenceState {
  overall: number;
  stateCompleteness: number;
  predictionReliability: number;
  lastUpdatedAt: string;
}

export interface RiskState {
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
  lastEscalationAt?: string;
}

export interface ToolState {
  lastToolName?: string;
  lastToolResultShape?: string;
  pendingToolNames: string[];
  observedArtifacts: Record<string, string>;
}

export interface StructuredDelta {
  id: string;
  createdAt: string;
  kind: DeltaKind;
  summary: string;
  evidence: string[];
  affectedFields: Array<keyof TaskSessionState>;
  estimatedTokens: number;
  localEvidence?: string;
}

export interface GatingHistoryEntry {
  turnId: string;
  createdAt: string;
  decision: GatingDecision;
  reason: string;
  taskType: TaskType;
  deltaKind: DeltaKind;
  confidenceBefore: number;
  confidenceAfter: number;
  fallbackTriggered: boolean;
}

export interface TaskSessionState {
  user_goal: string;
  hard_constraints: string[];
  soft_preferences: string[];
  current_plan: string[];
  open_questions: string[];
  known_facts: Record<string, string>;
  tool_state: ToolState;
  risk_state: RiskState;
  confidence_state: ConfidenceState;
  task_type: TaskType;
  conversation_mode: ConversationMode;
  recent_deltas: StructuredDelta[];
  gating_history: GatingHistoryEntry[];
}

export interface PredictedNextState {
  expectedDeltaKinds: DeltaKind[];
  expectedAffectedFields: Array<keyof TaskSessionState>;
  expectedToolResultShape?: string;
  expectedNextAction: string;
  confidence: number;
}

export interface Valuation {
  prediction_error: number;
  action_relevance: number;
  risk_delta: number;
  novelty: number;
  conflict: number;
  compressibility: number;
}

export interface ProfileThresholds {
  absorbMaxActionRelevance: number;
  absorbMaxPredictionError: number;
  injectMaxRiskDelta: number;
  partialRefreshConflict: number;
  fullRefreshRisk: number;
  fullRefreshConflict: number;
  minConfidenceToGate: number;
}

export interface PluginConfig {
  enabled: boolean;
  defaultProfile: TaskType;
  logPath?: string;
  maxRecentDeltas: number;
  forceFullRefreshAfterCorrections: number;
  profiles: Record<TaskType, ProfileThresholds>;
}

export interface DecisionRecord {
  schema_version: "predictive-gating.v1";
  turn_id: string;
  session_id: string;
  created_at: string;
  estimated_full_context_tokens_avoided: number;
  gating_decision: GatingDecision;
  delta_size: number;
  fallback_triggered: boolean;
  fallback_reason?: string;
  task_type: TaskType;
  confidence_before: number;
  confidence_after: number;
  valuation: Valuation;
  delta: StructuredDelta;
}

export interface GateInput {
  sessionId: string;
  turnId?: string;
  text: string;
  taskType?: TaskType;
  conversationMode?: ConversationMode;
  fullContextTokenEstimate?: number;
  observedToolName?: string;
  observedToolResult?: unknown;
}

export interface GateResult {
  decision: GatingDecision;
  state: TaskSessionState;
  delta: StructuredDelta;
  record: DecisionRecord;
  injectedContext: string;
}
