import assert from "node:assert/strict";
import test from "node:test";
import { GatingEngine } from "../src/gating-engine.js";
import type { TaskType } from "../src/types.js";

const taskTypes: TaskType[] = [
  "workflow_local_delta",
  "coding_iterative",
  "research_global_reinterpretation",
  "safety_critical"
];

test("simulates all supported task classes", async () => {
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

test("fallback recovers after repeated correction loop", async () => {
  const engine = new GatingEngine();
  await engine.process({ sessionId: "bad-loop", text: "Actually, that is wrong.", taskType: "coding_iterative" });
  await engine.process({ sessionId: "bad-loop", text: "No, you missed it again.", taskType: "coding_iterative" });
  const result = await engine.process({ sessionId: "bad-loop", text: "This is not helpful.", taskType: "coding_iterative" });

  assert.equal(result.decision, "request_full_refresh");
  assert.equal(result.record.fallback_triggered, true);
});
