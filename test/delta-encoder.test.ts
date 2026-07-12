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
  assert.equal(delta.observedToolResultShape, "object(ok)");
});

test("classifies Chinese safety signals and acknowledgements", () => {
  const store = new StateStore();
  const state = store.getOrCreate("s1", "coding_iterative", "default");
  const prediction = new Predictor().predict(state);
  const encoder = new DeltaEncoder();

  assert.equal(encoder.encode({ sessionId: "s1", text: "必须禁止把密钥写入日志" }, state, prediction).kind, "constraint_change");
  assert.equal(encoder.encode({ sessionId: "s1", text: "不对，漏了空值处理" }, state, prediction).kind, "correction");
  assert.equal(encoder.encode({ sessionId: "s1", text: "好的" }, state, prediction).kind, "acknowledgement");
});

test("does not treat an ordinary code-fix instruction as user correction", () => {
  const store = new StateStore();
  const state = store.getOrCreate("s1", "coding_iterative", "default");
  const prediction = new Predictor().predict(state);
  const delta = new DeltaEncoder().encode(
    { sessionId: "s1", text: "The test output shows a failing assertion. Fix that local regression." },
    state,
    prediction
  );

  assert.equal(delta.kind, "new_evidence");
});
