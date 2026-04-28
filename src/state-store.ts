import type { ConversationMode, GatingHistoryEntry, StructuredDelta, TaskSessionState, TaskType } from "./types.js";

export class StateStore {
  private readonly sessions = new Map<string, TaskSessionState>();

  getOrCreate(sessionId: string, taskType: TaskType, conversationMode: ConversationMode): TaskSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.task_type = taskType;
      existing.conversation_mode = conversationMode;
      return existing;
    }

    const now = new Date().toISOString();
    const created: TaskSessionState = {
      user_goal: "",
      hard_constraints: [],
      soft_preferences: [],
      current_plan: [],
      open_questions: [],
      known_facts: {},
      tool_state: { pendingToolNames: [], observedArtifacts: {} },
      risk_state: { level: "low", reasons: [] },
      confidence_state: {
        overall: 0.55,
        stateCompleteness: 0.45,
        predictionReliability: 0.55,
        lastUpdatedAt: now
      },
      task_type: taskType,
      conversation_mode: conversationMode,
      recent_deltas: [],
      gating_history: []
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  inspect(sessionId?: string): TaskSessionState | Record<string, TaskSessionState> | undefined {
    return sessionId ? this.sessions.get(sessionId) : Object.fromEntries(this.sessions.entries());
  }

  applyDelta(state: TaskSessionState, delta: StructuredDelta, maxRecentDeltas: number): void {
    state.recent_deltas.unshift(delta);
    state.recent_deltas = state.recent_deltas.slice(0, maxRecentDeltas);

    if (delta.kind === "global_goal_change" && delta.localEvidence) state.user_goal = delta.localEvidence;
    if (delta.kind === "constraint_change" && delta.localEvidence) {
      state.hard_constraints = appendUnique(state.hard_constraints, delta.localEvidence);
    }
    if (delta.kind === "new_evidence" && delta.localEvidence) state.known_facts[delta.id] = delta.localEvidence;
    if (delta.kind === "tool_result" && delta.localEvidence) state.tool_state.observedArtifacts[delta.id] = delta.localEvidence;
    if (delta.kind === "correction" || delta.kind === "dissatisfaction" || delta.kind === "conflict") {
      state.risk_state.level = state.risk_state.level === "critical" ? "critical" : "high";
      state.risk_state.reasons = appendUnique(state.risk_state.reasons, delta.summary);
    }
  }

  recordHistory(state: TaskSessionState, entry: GatingHistoryEntry, maxEntries = 100): void {
    state.gating_history.unshift(entry);
    state.gating_history = state.gating_history.slice(0, maxEntries);
    state.confidence_state.overall = entry.confidenceAfter;
    state.confidence_state.lastUpdatedAt = entry.createdAt;
  }
}

function appendUnique(values: string[], next: string): string[] {
  return values.includes(next) ? values : [...values, next];
}
