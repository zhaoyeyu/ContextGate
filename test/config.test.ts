import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, resolveConfig } from "../src/config.js";

test("uses observation and metadata-only logging as safe defaults", () => {
  const config = resolveConfig(undefined);

  assert.equal(config.operationMode, "observe");
  assert.equal(config.contentLogging, "metadata");
  assert.equal(config.allowSensitiveDiagnostics, false);
});

test("bounds runtime configuration even when host schema validation is bypassed", () => {
  const config = resolveConfig({
    maxRecentDeltas: -5,
    maxSessions: 50_000,
    sessionTtlMinutes: 0,
    preserveRecentMessages: 99,
    forceFullRefreshAfterCorrections: 0,
    profiles: {
      coding_iterative: {
        fullRefreshRisk: 2,
        injectMaxRiskDelta: 9,
        fullRefreshConflict: 0.3,
        partialRefreshConflict: 0.9,
        minConfidenceToGate: Number.NaN
      }
    }
  });

  assert.equal(config.maxRecentDeltas, 1);
  assert.equal(config.maxSessions, 10_000);
  assert.equal(config.sessionTtlMinutes, 1);
  assert.equal(config.preserveRecentMessages, 50);
  assert.equal(config.forceFullRefreshAfterCorrections, 1);
  assert.equal(config.profiles.coding_iterative.fullRefreshRisk, 1);
  assert.equal(config.profiles.coding_iterative.injectMaxRiskDelta, 1);
  assert.equal(config.profiles.coding_iterative.partialRefreshConflict, 0.3);
  assert.equal(config.profiles.coding_iterative.minConfidenceToGate, defaultConfig.profiles.coding_iterative.minConfidenceToGate);
});

test("rejects empty, overlong, and NUL-containing paths", () => {
  assert.equal(resolveConfig({ logPath: " " }).logPath, undefined);
  assert.equal(resolveConfig({ statePath: `unsafe\0path` }).statePath, undefined);
  assert.equal(resolveConfig({ logPath: "x".repeat(4097) }).logPath, undefined);
});
