import assert from "node:assert/strict";
import test from "node:test";
import { DeltaEncoder } from "../src/delta-encoder.js";
import { Predictor } from "../src/predictor.js";
import { StateStore } from "../src/state-store.js";

test("classifies corrections and constraint changes", () => {
  const store = new StateStore();
  const state = store.getOrCreate("s1", "coding_iterative", "default");
  const prediction = new Predictor().predict(state);
  const encoder = new DeltaEncoder();

  assert.equal(encoder.encode({ sessionId: "s1", text: "Actually, you missed the null case." }, state, prediction).kind, "correction");
  assert.equal(encoder.encode({ sessionId: "s1", text: "You must never call the network here." }, state, prediction).kind, "constraint_change");
});

test("classifies tool results before textual heuristics", () => {
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
