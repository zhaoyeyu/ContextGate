import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConversationMode, GatingHistoryEntry, StructuredDelta, TaskSessionState, TaskType } from "./types.js";

interface StoredSession {
  state: TaskSessionState;
  lastAccessedAt: string;
}

interface PersistedState {
  schemaVersion: 1;
  sessions: Array<{ sessionId: string; lastAccessedAt: string; state: TaskSessionState }>;
}

export interface StateStoreOptions {
  maxSessions?: number;
  sessionTtlMinutes?: number;
  statePath?: string;
}

export class StateStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;
  private readonly statePath?: string;
  private readonly loadPromise: Promise<void>;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceWarning?: string;

  constructor(options: StateStoreOptions = {}) {
    this.maxSessions = boundedInteger(options.maxSessions, 500, 1, 10_000);
    this.sessionTtlMs = boundedInteger(options.sessionTtlMinutes, 1440, 1, 10_080) * 60_000;
    this.statePath = options.statePath;
    this.loadPromise = this.statePath ? this.load() : Promise.resolve();
  }

  async ready(): Promise<void> {
    await this.loadPromise;
  }

  getOrCreate(sessionId: string, taskType: TaskType, conversationMode: ConversationMode): TaskSessionState {
    const now = new Date();
    this.evictExpired(now.getTime());
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.state.task_type = taskType;
      existing.state.conversation_mode = conversationMode;
      existing.lastAccessedAt = now.toISOString();
      return existing.state;
    }

    this.evictOldestIfAtCapacity();
    const created = createInitialState(taskType, conversationMode, now.toISOString());
    this.sessions.set(sessionId, { state: created, lastAccessedAt: now.toISOString() });
    return created;
  }

  getExisting(sessionId: string): TaskSessionState | undefined {
    this.evictExpired(Date.now());
    const stored = this.sessions.get(sessionId);
    if (!stored) return undefined;
    stored.lastAccessedAt = new Date().toISOString();
    return stored.state;
  }

  inspect(sessionId?: string): TaskSessionState | Record<string, TaskSessionState> | undefined {
    this.evictExpired(Date.now());
    if (sessionId) {
      const state = this.sessions.get(sessionId)?.state;
      return state ? structuredClone(state) : undefined;
    }
    return Object.fromEntries(
      [...this.sessions.entries()].map(([id, stored]) => [id, structuredClone(stored.state)])
    );
  }

  applyDelta(state: TaskSessionState, delta: StructuredDelta, maxRecentDeltas: number): void {
    state.recent_deltas.unshift(delta);
    state.recent_deltas = state.recent_deltas.slice(0, maxRecentDeltas);

    if (delta.kind === "global_goal_change" && delta.localEvidence) {
      state.user_goal = delta.localEvidence;
      state.current_plan = [];
      state.open_questions = [];
    }
    if (delta.kind === "local_instruction_change" && delta.localEvidence) {
      state.current_plan = appendUniqueBounded(state.current_plan, delta.localEvidence, maxRecentDeltas);
    }
    if (delta.kind === "clarification" && delta.localEvidence) {
      state.open_questions = appendUniqueBounded(state.open_questions, delta.localEvidence, maxRecentDeltas);
    }
    if (delta.kind === "constraint_change" && delta.localEvidence) {
      state.hard_constraints = appendUniqueBounded(state.hard_constraints, delta.localEvidence, maxRecentDeltas);
      state.risk_state.level = raiseRisk(state.risk_state.level, "medium");
      state.risk_state.reasons = appendUniqueBounded(state.risk_state.reasons, delta.summary, maxRecentDeltas);
    }
    if (delta.kind === "new_evidence" && delta.localEvidence) {
      setBoundedRecord(state.known_facts, delta.id, delta.localEvidence, maxRecentDeltas);
    }
    if (delta.kind === "tool_result" && delta.localEvidence) {
      setBoundedRecord(state.tool_state.observedArtifacts, delta.id, delta.localEvidence, maxRecentDeltas);
      state.tool_state.lastToolName = delta.observedToolName;
      state.tool_state.lastToolResultShape = delta.observedToolResultShape;
    }
    if (delta.kind === "correction" || delta.kind === "dissatisfaction" || delta.kind === "conflict") {
      state.risk_state.level = raiseRisk(state.risk_state.level, "high");
      state.risk_state.reasons = appendUniqueBounded(state.risk_state.reasons, delta.summary, maxRecentDeltas);
      state.risk_state.lastEscalationAt = delta.createdAt;
    }
    if (delta.kind !== "none" && delta.kind !== "acknowledgement") {
      state.confidence_state.stateCompleteness = Math.min(1, state.confidence_state.stateCompleteness + 0.03);
    }
  }

  recordHistory(state: TaskSessionState, entry: GatingHistoryEntry, maxEntries = 100): void {
    state.gating_history.unshift(entry);
    state.gating_history = state.gating_history.slice(0, maxEntries);
    state.confidence_state.overall = entry.confidenceAfter;
    state.confidence_state.lastUpdatedAt = entry.createdAt;
    if (entry.decision === "request_full_refresh") {
      state.confidence_state.stateCompleteness = Math.max(state.confidence_state.stateCompleteness, 0.8);
      state.confidence_state.predictionReliability = Math.max(state.confidence_state.predictionReliability, 0.6);
      if (entry.taskType !== "safety_critical" && state.risk_state.level === "high") {
        state.risk_state.level = "medium";
      }
    } else if (entry.decision === "request_partial_refresh") {
      state.confidence_state.stateCompleteness = Math.max(state.confidence_state.stateCompleteness, 0.65);
    }
  }

  async persist(): Promise<string | undefined> {
    if (!this.statePath) return this.takePersistenceWarning();
    await this.ready();
    const snapshot: PersistedState = {
      schemaVersion: 1,
      sessions: [...this.sessions.entries()].map(([sessionId, stored]) => ({
        sessionId,
        lastAccessedAt: stored.lastAccessedAt,
        state: structuredClone(stored.state)
      }))
    };
    const target = this.statePath;
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const operation = this.persistenceQueue.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temp, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temp, target);
    });
    this.persistenceQueue = operation.catch(() => undefined);
    try {
      await operation;
    } catch (error) {
      this.persistenceWarning = `state persistence failed (${errorCode(error)})`;
    }
    return this.takePersistenceWarning();
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath!, "utf8")) as unknown;
      if (!isPersistedState(parsed)) {
        this.persistenceWarning = "state persistence file has an unsupported or invalid schema";
        return;
      }
      for (const entry of parsed.sessions) {
        if (this.sessions.size >= this.maxSessions) break;
        this.sessions.set(entry.sessionId, {
          state: entry.state,
          lastAccessedAt: Number.isFinite(Date.parse(entry.lastAccessedAt))
            ? entry.lastAccessedAt
            : new Date().toISOString()
        });
      }
      this.evictExpired(Date.now());
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        this.persistenceWarning = `state persistence could not be loaded (${errorCode(error)})`;
      }
    }
  }

  private evictExpired(now: number): void {
    for (const [sessionId, stored] of this.sessions) {
      const lastAccess = Date.parse(stored.lastAccessedAt);
      if (!Number.isFinite(lastAccess) || now - lastAccess > this.sessionTtlMs) this.sessions.delete(sessionId);
    }
  }

  private evictOldestIfAtCapacity(): void {
    if (this.sessions.size < this.maxSessions) return;
    let oldest: { sessionId: string; timestamp: number } | undefined;
    for (const [sessionId, stored] of this.sessions) {
      const timestamp = Date.parse(stored.lastAccessedAt);
      if (!oldest || timestamp < oldest.timestamp) oldest = { sessionId, timestamp };
    }
    if (oldest) this.sessions.delete(oldest.sessionId);
  }

  private takePersistenceWarning(): string | undefined {
    const warning = this.persistenceWarning;
    this.persistenceWarning = undefined;
    return warning;
  }
}

export function createInitialState(
  taskType: TaskType,
  conversationMode: ConversationMode,
  now = new Date().toISOString()
): TaskSessionState {
  return {
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
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PersistedState>;
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.sessions) &&
    candidate.sessions.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.sessionId === "string" &&
        typeof entry.lastAccessedAt === "string" &&
        isTaskSessionState(entry.state)
    )
  );
}

function isTaskSessionState(value: unknown): value is TaskSessionState {
  if (!isRecord(value)) return false;
  const state = value as Partial<TaskSessionState>;
  return (
    typeof state.user_goal === "string" &&
    isStringArray(state.hard_constraints) &&
    isStringArray(state.soft_preferences) &&
    isStringArray(state.current_plan) &&
    isStringArray(state.open_questions) &&
    isStringRecord(state.known_facts) &&
    isToolState(state.tool_state) &&
    isRiskState(state.risk_state) &&
    isConfidenceState(state.confidence_state) &&
    isTaskType(state.task_type) &&
    isConversationMode(state.conversation_mode) &&
    Array.isArray(state.recent_deltas) &&
    state.recent_deltas.every(isStructuredDelta) &&
    Array.isArray(state.gating_history) &&
    state.gating_history.every(isHistoryEntry)
  );
}

function isToolState(value: unknown): value is TaskSessionState["tool_state"] {
  if (!isRecord(value)) return false;
  return (
    optionalString(value.lastToolName) &&
    optionalString(value.lastToolResultShape) &&
    isStringArray(value.pendingToolNames) &&
    isStringRecord(value.observedArtifacts)
  );
}

function isRiskState(value: unknown): value is TaskSessionState["risk_state"] {
  if (!isRecord(value)) return false;
  return (
    (value.level === "low" || value.level === "medium" || value.level === "high" || value.level === "critical") &&
    isStringArray(value.reasons) &&
    optionalString(value.lastEscalationAt)
  );
}

function isConfidenceState(value: unknown): value is TaskSessionState["confidence_state"] {
  if (!isRecord(value)) return false;
  return (
    isUnitInterval(value.overall) &&
    isUnitInterval(value.stateCompleteness) &&
    isUnitInterval(value.predictionReliability) &&
    typeof value.lastUpdatedAt === "string"
  );
}

function isStructuredDelta(value: unknown): value is StructuredDelta {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    isDeltaKind(value.kind) &&
    typeof value.summary === "string" &&
    isStringArray(value.evidence) &&
    Array.isArray(value.affectedFields) &&
    value.affectedFields.every((field) => typeof field === "string") &&
    typeof value.estimatedTokens === "number" &&
    Number.isFinite(value.estimatedTokens) &&
    optionalString(value.localEvidence) &&
    optionalString(value.observedToolName) &&
    optionalString(value.observedToolResultShape)
  );
}

function isHistoryEntry(value: unknown): value is GatingHistoryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnId === "string" &&
    typeof value.createdAt === "string" &&
    isDecision(value.decision) &&
    typeof value.reason === "string" &&
    isTaskType(value.taskType) &&
    isDeltaKind(value.deltaKind) &&
    isUnitInterval(value.confidenceBefore) &&
    isUnitInterval(value.confidenceAfter) &&
    typeof value.fallbackTriggered === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTaskType(value: unknown): value is TaskType {
  return value === "workflow_local_delta" ||
    value === "coding_iterative" ||
    value === "research_global_reinterpretation" ||
    value === "safety_critical";
}

function isConversationMode(value: unknown): value is ConversationMode {
  return value === "default" || value === "review" || value === "planning" || value === "execution" || value === "debug";
}

function isDecision(value: unknown): value is GatingHistoryEntry["decision"] {
  return value === "absorb" || value === "inject_delta" || value === "request_partial_refresh" || value === "request_full_refresh";
}

function isDeltaKind(value: unknown): value is StructuredDelta["kind"] {
  return value === "none" ||
    value === "acknowledgement" ||
    value === "clarification" ||
    value === "local_instruction_change" ||
    value === "global_goal_change" ||
    value === "constraint_change" ||
    value === "new_evidence" ||
    value === "tool_result" ||
    value === "correction" ||
    value === "dissatisfaction" ||
    value === "conflict";
}

function raiseRisk(current: TaskSessionState["risk_state"]["level"], minimum: "medium" | "high"):
  TaskSessionState["risk_state"]["level"] {
  const order: TaskSessionState["risk_state"]["level"][] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(current), order.indexOf(minimum))]!;
}

function appendUniqueBounded(values: string[], next: string, maximum: number): string[] {
  return (values.includes(next) ? values : [...values, next]).slice(-maximum);
}

function setBoundedRecord(record: Record<string, string>, key: string, value: string, maximum: number): void {
  record[key] = value;
  const keys = Object.keys(record);
  for (const stale of keys.slice(0, Math.max(0, keys.length - maximum))) delete record[stale];
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Number(value)));
}
