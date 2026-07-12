import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StateStore } from "../src/state-store.js";
import type { StructuredDelta, TaskSessionState } from "../src/types.js";

test("bounds in-memory sessions with least-recently-used eviction", () => {
  const store = new StateStore({ maxSessions: 1 });
  store.getOrCreate("first", "coding_iterative", "default");
  store.getOrCreate("second", "coding_iterative", "default");

  assert.equal(store.inspect("first"), undefined);
  assert.ok(store.inspect("second"));
});

test("persists state atomically and restores it on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-gate-state-"));
  try {
    const statePath = join(directory, "state.json");
    const first = new StateStore({ statePath });
    await first.ready();
    const state = first.getOrCreate("session", "coding_iterative", "default");
    first.applyDelta(state, delta("local_instruction_change", "keep this plan"), 20);
    assert.equal(await first.persist(), undefined);

    const second = new StateStore({ statePath });
    await second.ready();
    const restored = second.inspect("session") as TaskSessionState;
    assert.deepEqual(restored.current_plan, ["keep this plan"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function delta(kind: StructuredDelta["kind"], localEvidence: string): StructuredDelta {
  return {
    id: "delta-1",
    createdAt: new Date().toISOString(),
    kind,
    summary: `${kind}: ${localEvidence}`,
    evidence: [localEvidence],
    affectedFields: ["current_plan"],
    estimatedTokens: 4,
    localEvidence
  };
}
