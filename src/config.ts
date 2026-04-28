import type { PluginConfig, ProfileThresholds, TaskType } from "./types.js";

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
  defaultProfile: "coding_iterative",
  maxRecentDeltas: 20,
  forceFullRefreshAfterCorrections: 2,
  profiles: defaultProfiles
};

export function resolveConfig(raw: unknown): PluginConfig {
  const value = isRecord(raw) ? raw : {};
  const profileOverrides = isRecord(value.profiles) ? value.profiles : {};
  const profiles = Object.fromEntries(
    Object.entries(defaultProfiles).map(([profile, thresholds]) => [
      profile,
      { ...thresholds, ...(isRecord(profileOverrides[profile]) ? profileOverrides[profile] : {}) }
    ])
  ) as Record<TaskType, ProfileThresholds>;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultConfig.enabled,
    defaultProfile: isTaskType(value.defaultProfile) ? value.defaultProfile : defaultConfig.defaultProfile,
    logPath: typeof value.logPath === "string" && value.logPath.length > 0 ? value.logPath : undefined,
    maxRecentDeltas: readInteger(value.maxRecentDeltas, defaultConfig.maxRecentDeltas),
    forceFullRefreshAfterCorrections: readInteger(
      value.forceFullRefreshAfterCorrections,
      defaultConfig.forceFullRefreshAfterCorrections
    ),
    profiles
  };
}

function readInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
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
