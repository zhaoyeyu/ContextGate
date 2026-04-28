import assert from "node:assert/strict";
import { defaultProfiles } from "../src/config.js";
import { DeltaEncoder } from "../src/delta-encoder.js";
import { GatingEngine } from "../src/gating-engine.js";
import { Predictor } from "../src/predictor.js";
import { StateStore } from "../src/state-store.js";
import type { TaskType } from "../src/types.js";
import { WorkspaceGate } from "../src/workspace-gate.js";

await run("classifies corrections and constraint changes", () => {
  const store = new StateStore();
  const state = store.getOrCreate("s1", "coding_iterative", "default");
  const prediction = new Predictor().predict(state);
  const encoder = new DeltaEncoder();

  assert.equal(encoder.encode({ sessionId: "s1", text: "Actually, you missed the null case." }, state, prediction).kind, "correction");
  assert.equal(encoder.encode({ sessionId: "s1", text: "You must never call the network here." }, state, prediction).kind, "constraint_change");
});

await run("classifies tool results before textual heuristics", () => {
  const store = new StateStore();
  const state = store.getOrCreate("s1", "coding_iterative", "default");
  const prediction = new Predictor().predict(state);
  const delta = new DeltaEncoder().encode(
    { sessionId: "s1", text: "fails but this is a tool result", observedToolResult: { ok: false } },
    state,
    prediction
  );

  assert.equal(delta.kind, "tool_result");
});

await run("absorbs low relevance predictable compressible input", () => {
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

await run("forces full refresh when risk crosses threshold", () => {
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

await run("simulates all supported task classes", async () => {
  const taskTypes: TaskType[] = [
    "workflow_local_delta",
    "coding_iterative",
    "research_global_reinterpretation",
    "safety_critical"
  ];

  for (const taskType of taskTypes) {
    const result = await new GatingEngine().process({
      sessionId: taskType,
      text: taskType.includes("safety") ? "Do not proceed if risk changes." : "Continue with the local change.",
      taskType,
      fullContextTokenEstimate: 2000
    });

    assert.equal(result.record.task_type, taskType);
    assert.ok(["absorb", "inject_delta", "request_partial_refresh", "request_full_refresh"].includes(result.decision));
  }
});

await run("fallback recovers after repeated correction loop", async () => {
  const engine = new GatingEngine();
  await engine.process({ sessionId: "bad-loop", text: "Actually, that is wrong.", taskType: "coding_iterative" });
  await engine.process({ sessionId: "bad-loop", text: "No, you missed it again.", taskType: "coding_iterative" });
  const result = await engine.process({ sessionId: "bad-loop", text: "This is not helpful.", taskType: "coding_iterative" });

  assert.equal(result.decision, "request_full_refresh");
  assert.equal(result.record.fallback_triggered, true);
});

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
