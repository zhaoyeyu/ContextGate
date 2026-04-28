import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfiles } from "../src/config.js";
import { StateStore } from "../src/state-store.js";
import { WorkspaceGate } from "../src/workspace-gate.js";

test("absorbs low relevance predictable compressible input", () => {
  const state = new StateStore().getOrCreate("s1", "workflow_local_delta", "default");
  const decision = new WorkspaceGate().decide(
    state,
    {
      prediction_error: 0.1,
      action_relevance: 0.1,
      risk_delta: 0.1,
      novelty: 0.1,
      conflict: 0.1,
      compressibility: 0.9
    },
    defaultProfiles.workflow_local_delta
  );

  assert.equal(decision, "absorb");
});

test("forces full refresh when risk crosses threshold", () => {
  const state = new StateStore().getOrCreate("s1", "safety_critical", "default");
  state.confidence_state.overall = 0.9;
  const decision = new WorkspaceGate().decide(
    state,
    {
      prediction_error: 0.2,
      action_relevance: 0.8,
      risk_delta: 0.7,
      novelty: 0.7,
      conflict: 0.2,
      compressibility: 0.3
    },
    defaultProfiles.safety_critical
  );

  assert.equal(decision, "request_full_refresh");
});
