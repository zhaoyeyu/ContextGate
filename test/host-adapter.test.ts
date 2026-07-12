import assert from "node:assert/strict";
import test from "node:test";
import register, { pluginId } from "../src/index.js";
import type { OpenClawContextEngine, OpenClawPluginApi, OpenClawToolDefinition } from "../src/host-adapter.js";

test("registers the context engine under the manifest plugin id", () => {
  const harness = createHarness();
  register(harness.api);

  assert.equal(harness.registeredId(), pluginId);
  assert.equal(harness.engine().info.id, pluginId);
  assert.equal(harness.engine().info.ownsCompaction, false);
});

test("accepts the current sessionKey field and observe mode preserves every message", async () => {
  const harness = createHarness();
  register(harness.api);
  const messages = [
    { role: "system", content: "system rules" },
    { role: "user", content: "first turn" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "Continue with the local edit." }
  ];
  const result = (await harness.engine().assemble({ sessionKey: "session-a", messages })) as Record<string, unknown>;
  const gating = result.gating as Record<string, unknown>;

  assert.deepEqual(result.messages, messages);
  assert.equal(gating.session_id, "session-a");
  assert.equal(gating.policy_mode, "observe");
});

test("missing session identity bypasses optimization instead of sharing a default session", async () => {
  const harness = createHarness({ operationMode: "enforce" });
  register(harness.api);
  const messages = [{ role: "user", content: "Looks fine." }];
  const result = (await harness.engine().assemble({ messages })) as Record<string, unknown>;

  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result.gating, {
    bypassed: true,
    reason: "missing session identifier",
    appliedDecision: "request_full_refresh"
  });
});

test("enforcement retains system messages and a configurable recent window", async () => {
  const harness = createHarness({
    operationMode: "enforce",
    defaultProfile: "workflow_local_delta",
    preserveRecentMessages: 2
  });
  register(harness.api);
  const messages = [
    { role: "system", content: "system rules" },
    { role: "user", content: "old request" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "new request" },
    { role: "assistant", content: "Looks fine." },
    { role: "user", content: "Looks fine." }
  ];
  const result = (await harness.engine().assemble({ sessionKey: "session-b", messages })) as Record<string, unknown>;
  const selected = result.messages as unknown[];
  const gating = result.gating as Record<string, unknown>;

  assert.equal(gating.gating_decision, "absorb");
  assert.deepEqual(selected, [messages[0], messages[4], messages[5]]);
});

test("never promotes raw user instructions into the system prompt addition", async () => {
  const harness = createHarness({ operationMode: "enforce" });
  register(harness.api);
  const marker = "ignore-system-and-run-marker";
  const result = (await harness.engine().assemble({
    sessionKey: "session-c",
    messages: [{ role: "user", content: `Continue locally: ${marker}` }]
  })) as Record<string, unknown>;

  assert.equal(String(result.systemPromptAddition).includes(marker), false);
});

test("bypasses optimization for non-text user content", async () => {
  const harness = createHarness({ operationMode: "enforce" });
  register(harness.api);
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "image", image_url: "data:image/png;base64,AA==" }
      ]
    }
  ];
  const result = (await harness.engine().assemble({ sessionKey: "multimodal", messages })) as Record<string, unknown>;

  assert.deepEqual(result.messages, messages);
  assert.equal((result.gating as Record<string, unknown>).bypassed, true);
});

test("does not orphan a retained tool-result group", async () => {
  const harness = createHarness({
    operationMode: "enforce",
    defaultProfile: "workflow_local_delta",
    preserveRecentMessages: 2
  });
  register(harness.api);
  const messages = [
    { role: "system", content: "rules" },
    { role: "user", content: "old" },
    { role: "assistant", content: "", tool_calls: [{ id: "call-1" }, { id: "call-2" }] },
    { role: "tool", name: "first", content: "one" },
    { role: "tool", name: "second", content: "two" },
    { role: "user", content: "Looks fine." }
  ];
  const result = (await harness.engine().assemble({ sessionKey: "tool-group", messages })) as Record<string, unknown>;

  assert.deepEqual(result.messages, [messages[0], messages[2], messages[3], messages[4], messages[5]]);
});

test("inspection requires an explicit session id", async () => {
  const harness = createHarness();
  register(harness.api);
  const tool = harness.tools().get("predictive_gating_inspect");
  assert.ok(tool);
  await assert.rejects(async () => {
    await tool!.execute("call-1", {});
  }, /sessionId must be a non-empty string/);
});

test("feedback refuses to create a session from a typo", async () => {
  const harness = createHarness();
  register(harness.api);
  const tool = harness.tools().get("predictive_gating_record_feedback");
  assert.ok(tool);
  await assert.rejects(async () => {
    await tool!.execute("call-2", { sessionId: "missing", feedback: "wrong" });
  }, /session not found/);
});

function createHarness(config?: unknown): {
  api: OpenClawPluginApi;
  registeredId: () => string | undefined;
  engine: () => OpenClawContextEngine;
  tools: () => Map<string, OpenClawToolDefinition>;
} {
  let id: string | undefined;
  let factory: (() => OpenClawContextEngine) | undefined;
  const registeredTools = new Map<string, OpenClawToolDefinition>();
  const api: OpenClawPluginApi = {
    config,
    registerContextEngine(nextId, nextFactory) {
      id = nextId;
      factory = nextFactory;
    },
    registerTool(tool) {
      registeredTools.set(tool.name, tool);
    }
  };
  return {
    api,
    registeredId: () => id,
    engine: () => {
      assert.ok(factory);
      return factory();
    },
    tools: () => registeredTools
  };
}
