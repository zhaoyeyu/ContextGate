import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { GatingEngine } from "../src/gating-engine.js";
import type { TaskSessionState } from "../src/types.js";

test("observation mode recommends a policy but preserves full context", async () => {
  const result = await new GatingEngine().process({
    sessionId: "observe",
    text: "Continue with the local code change.",
    taskType: "coding_iterative",
    fullContextTokenEstimate: 1_000
  });

  assert.equal(result.decision, "request_full_refresh");
  assert.equal(result.record.recommended_gating_decision, "inject_delta");
  assert.equal(result.record.estimated_full_context_tokens_avoided, 0);
  assert.ok(result.record.estimated_tokens_avoided_if_enforced > 0);
  assert.equal(result.record.explanation.matchedRule, "bounded_local_delta");
});

test("enforcement mode applies a bounded local delta recommendation", async () => {
  const engine = new GatingEngine(undefined, resolveConfig({ operationMode: "enforce" }));
  const result = await engine.process({
    sessionId: "enforce",
    text: "Continue with the local code change.",
    taskType: "coding_iterative",
    fullContextTokenEstimate: 1_000
  });

  assert.equal(result.decision, "inject_delta");
  assert.equal(result.record.gating_decision, "inject_delta");
});

test("fails safely on invalid session identifiers", async () => {
  const result = await new GatingEngine(undefined, resolveConfig({ operationMode: "enforce" })).process({
    sessionId: "",
    text: "drop the history"
  });

  assert.equal(result.decision, "request_full_refresh");
  assert.equal(result.record.explanation.matchedRule, "fail_safe");
});

test("deduplicates retries that carry the same turn id and content", async () => {
  const engine = new GatingEngine(undefined, resolveConfig({ operationMode: "enforce" }));
  const input = { sessionId: "retry", turnId: "turn-1", text: "Continue locally." } as const;
  await engine.process(input);
  await engine.process(input);
  const inspected = engine.inspect("retry", true) as TaskSessionState;

  assert.equal(inspected.gating_history.length, 1);
  assert.equal(inspected.recent_deltas.length, 1);
});

test("metadata logging omits conversation content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-gate-log-"));
  try {
    const logPath = join(directory, "decisions.jsonl");
    const secret = "private-marker-7f93f9";
    const engine = new GatingEngine(undefined, resolveConfig({ logPath, contentLogging: "metadata" }));
    await engine.process({ sessionId: "private", text: `New goal: ${secret}` });

    const logged = await readFile(logPath, "utf8");
    assert.equal(logged.includes(secret), false);
    assert.match(logged, /global_goal_change update/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("logging failures do not break context decisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-gate-log-error-"));
  try {
    const engine = new GatingEngine(undefined, resolveConfig({ logPath: directory }));
    const result = await engine.process({ sessionId: "log-error", text: "Continue locally." });

    assert.equal(result.decision, "request_full_refresh");
    assert.ok(result.record.explanation.warnings.some((warning) => warning.includes("decision logging failed")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics are redacted unless sensitive inspection is explicitly allowed", async () => {
  const secret = "sensitive-goal-marker";
  const redactedEngine = new GatingEngine();
  await redactedEngine.process({ sessionId: "redacted", text: `New goal: ${secret}` });
  const redacted = redactedEngine.inspect("redacted") as TaskSessionState;
  assert.equal(redacted.user_goal, "[redacted]");

  const rawEngine = new GatingEngine(
    undefined,
    resolveConfig({ allowSensitiveDiagnostics: true })
  );
  await rawEngine.process({ sessionId: "raw", text: `New goal: ${secret}` });
  const raw = rawEngine.inspect("raw", true) as TaskSessionState;
  assert.match(raw.user_goal, new RegExp(secret));
});
