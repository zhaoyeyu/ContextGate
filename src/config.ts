import type {
  ContentLoggingMode,
  OperationMode,
  PluginConfig,
  ProfileThresholds,
  TaskType
} from "./types.js";

export const defaultProfiles: Record<TaskType, ProfileThresholds> = {
  workflow_local_delta: {
    absorbMaxActionRelevance: 0.25,
    absorbMaxPredictionError: 0.35,
    injectMaxRiskDelta: 0.35,
    partialRefreshConflict: 0.45,
    fullRefreshRisk: 0.75,
    fullRefreshConflict: 0.75,
    minConfidenceToGate: 0.45
  },
  coding_iterative: {
    absorbMaxActionRelevance: 0.2,
    absorbMaxPredictionError: 0.3,
    injectMaxRiskDelta: 0.3,
    partialRefreshConflict: 0.4,
    fullRefreshRisk: 0.65,
    fullRefreshConflict: 0.65,
    minConfidenceToGate: 0.5
  },
  research_global_reinterpretation: {
    absorbMaxActionRelevance: 0.12,
    absorbMaxPredictionError: 0.18,
    injectMaxRiskDelta: 0.18,
    partialRefreshConflict: 0.25,
    fullRefreshRisk: 0.45,
    fullRefreshConflict: 0.45,
    minConfidenceToGate: 0.7
  },
  safety_critical: {
    absorbMaxActionRelevance: 0.08,
    absorbMaxPredictionError: 0.12,
    injectMaxRiskDelta: 0.12,
    partialRefreshConflict: 0.18,
    fullRefreshRisk: 0.3,
    fullRefreshConflict: 0.3,
    minConfidenceToGate: 0.82
  }
};

export const defaultConfig: PluginConfig = {
  enabled: true,
  operationMode: "observe",
  contentLogging: "metadata",
  allowSensitiveDiagnostics: false,
  defaultProfile: "coding_iterative",
  maxRecentDeltas: 20,
  maxSessions: 500,
  sessionTtlMinutes: 1440,
  preserveRecentMessages: 6,
  forceFullRefreshAfterCorrections: 2,
  profiles: defaultProfiles
};

export function resolveConfig(raw: unknown): PluginConfig {
  const value = isRecord(raw) ? raw : {};
  const profileOverrides = isRecord(value.profiles) ? value.profiles : {};
  const profiles = Object.fromEntries(
    Object.entries(defaultProfiles).map(([profile, thresholds]) => {
      const overrides = isRecord(profileOverrides[profile]) ? profileOverrides[profile] : {};
      return [profile, resolveThresholds(overrides, thresholds)];
    })
  ) as Record<TaskType, ProfileThresholds>;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultConfig.enabled,
    operationMode: readOperationMode(value.operationMode),
    contentLogging: readContentLoggingMode(value.contentLogging),
    allowSensitiveDiagnostics:
      typeof value.allowSensitiveDiagnostics === "boolean"
        ? value.allowSensitiveDiagnostics
        : defaultConfig.allowSensitiveDiagnostics,
    defaultProfile: isTaskType(value.defaultProfile) ? value.defaultProfile : defaultConfig.defaultProfile,
    logPath: readPath(value.logPath),
    statePath: readPath(value.statePath),
    maxRecentDeltas: readInteger(value.maxRecentDeltas, defaultConfig.maxRecentDeltas, 1, 100),
    maxSessions: readInteger(value.maxSessions, defaultConfig.maxSessions, 1, 10_000),
    sessionTtlMinutes: readInteger(value.sessionTtlMinutes, defaultConfig.sessionTtlMinutes, 1, 10_080),
    preserveRecentMessages: readInteger(
      value.preserveRecentMessages,
      defaultConfig.preserveRecentMessages,
      1,
      50
    ),
    forceFullRefreshAfterCorrections: readInteger(
      value.forceFullRefreshAfterCorrections,
      defaultConfig.forceFullRefreshAfterCorrections,
      1,
      10
    ),
    profiles
  };
}

function resolveThresholds(raw: Record<string, unknown>, fallback: ProfileThresholds): ProfileThresholds {
  const fullRefreshRisk = readUnitInterval(raw.fullRefreshRisk, fallback.fullRefreshRisk);
  const fullRefreshConflict = readUnitInterval(raw.fullRefreshConflict, fallback.fullRefreshConflict);
  return {
    absorbMaxActionRelevance: readUnitInterval(
      raw.absorbMaxActionRelevance,
      fallback.absorbMaxActionRelevance
    ),
    absorbMaxPredictionError: readUnitInterval(
      raw.absorbMaxPredictionError,
      fallback.absorbMaxPredictionError
    ),
    injectMaxRiskDelta: Math.min(
      readUnitInterval(raw.injectMaxRiskDelta, fallback.injectMaxRiskDelta),
      fullRefreshRisk
    ),
    partialRefreshConflict: Math.min(
      readUnitInterval(raw.partialRefreshConflict, fallback.partialRefreshConflict),
      fullRefreshConflict
    ),
    fullRefreshRisk,
    fullRefreshConflict,
    minConfidenceToGate: readUnitInterval(raw.minConfidenceToGate, fallback.minConfidenceToGate)
  };
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function readUnitInterval(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function readPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 4096 && !trimmed.includes("\0") ? trimmed : undefined;
}

function readOperationMode(value: unknown): OperationMode {
  return value === "enforce" || value === "observe" ? value : defaultConfig.operationMode;
}

function readContentLoggingMode(value: unknown): ContentLoggingMode {
  return value === "full" || value === "metadata" ? value : defaultConfig.contentLogging;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskType(value: unknown): value is TaskType {
  return (
    value === "workflow_local_delta" ||
    value === "coding_iterative" ||
    value === "research_global_reinterpretation" ||
    value === "safety_critical"
  );
}
