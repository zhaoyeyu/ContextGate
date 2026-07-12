# ContextGate

ContextGate is an explainable context-update policy engine for OpenClaw. It classifies what changed in the latest turn, scores the update against a selected risk profile, and recommends one of four actions:

- `absorb`: record a non-actionable acknowledgement without rebuilding context.
- `inject_delta`: keep a bounded recent window for a local, low-risk update.
- `request_partial_refresh`: retain the complete host history because broader evidence may matter.
- `request_full_refresh`: retain the complete host history when risk, conflict, uncertainty, or a fallback rule requires it.

The safe default is `observe`. In this mode ContextGate records and explains recommendations but always passes the full message history to the model. Context reduction happens only after an operator explicitly selects `enforce`.

## Requirements

- Node.js 22 or newer
- OpenClaw plugin API 2026.5.27 or newer
- npm

## Install from source

```bash
git clone https://github.com/zhaoyeyu/ContextGate.git
cd ContextGate
npm ci
npm run build
openclaw plugins install -l .
openclaw plugins enable openclaw-plugin-predictive-gating
```

Select the registered engine id, which intentionally matches the manifest plugin id:

```json5
{
  plugins: {
    slots: {
      contextEngine: "openclaw-plugin-predictive-gating",
    },
    entries: {
      "openclaw-plugin-predictive-gating": {
        enabled: true,
        config: {
          operationMode: "observe",
          defaultProfile: "coding_iterative",
          logPath: ".openclaw/context-gate-decisions.jsonl",
        },
      },
    },
  },
}
```

Restart the OpenClaw gateway after selecting the engine. If the runtime does not support context assembly before prompting, select the built-in `legacy` engine instead.

To install an archive rather than linking a checkout:

```bash
npm ci
npm pack
openclaw plugins install ./openclaw-plugin-predictive-gating-0.2.0.tgz
```

## Safe rollout

1. Start with `operationMode: "observe"`.
2. Run representative conversations and inspect recommendation counts, fallback reasons, and disagreement with expected decisions.
3. Tune a profile only when the saved evidence justifies the change.
4. Enable `operationMode: "enforce"` for a low-risk workload first.
5. Return to `observe` or the `legacy` engine if correctness, tool-call continuity, or prompt quality regresses.

In enforcement mode, `absorb` and `inject_delta` preserve system/developer messages plus the configured recent-message window. Partial and full refresh decisions preserve the complete host-provided history.

## Configuration

General controls:

- `enabled`: when false, always requests full context.
- `operationMode`: `observe` (default) or `enforce`.
- `defaultProfile`: policy profile used when the host does not specify a task type.
- `preserveRecentMessages`: recent messages retained for enforced absorb/delta decisions; default `6`.
- `maxRecentDeltas`: structured deltas kept per session; default `20`.
- `maxSessions`: in-memory session ceiling with least-recently-used eviction; default `500`.
- `sessionTtlMinutes`: idle session lifetime; default one day.
- `forceFullRefreshAfterCorrections`: correction-loop fallback threshold.

Privacy and storage controls:

- `logPath`: optional JSONL decision log.
- `contentLogging`: `metadata` (default) strips message content and hashes session/turn ids; `full` records raw values.
- `statePath`: optional atomically replaced state snapshot for restart recovery. State snapshots contain conversation-derived content and are not encrypted by ContextGate.
- `allowSensitiveDiagnostics`: allows raw diagnostic state only when explicitly set to `true`; default diagnostics are redacted.

Profiles:

- `workflow_local_delta`: permissive for repetitive, local workflows.
- `coding_iterative`: balanced for edit/test/debug loops.
- `research_global_reinterpretation`: conservative when new evidence can change the overall conclusion.
- `safety_critical`: the strictest profile for consequential actions.

Each profile exposes bounded `0..1` thresholds for action relevance, prediction error, risk, conflict, and minimum confidence. Runtime resolution clamps values even when the host schema is bypassed, and it normalizes partial-refresh boundaries so they cannot exceed full-refresh boundaries.

## Explainability and diagnostics

Decision records use schema `predictive-gating.v2`. Each record includes:

- the recommended and applied decisions;
- the matched policy rule and plain-language reason;
- the active profile, signal values, and thresholds;
- fallback and safe-bypass warnings;
- applied and hypothetical token-avoidance estimates;
- structured delta metadata.

Inspect one session with:

```text
/predictive-gating-inspect sessionId=<id>
```

The `predictive_gating_inspect` tool exposes the same session-scoped view. It never returns all sessions implicitly. The `predictive_gating_record_feedback` tool records corrections or dissatisfaction and requires an explicit session id.

## Evaluation

Run the deterministic policy fixtures:

```bash
npm run evaluate
```

This writes `evaluation-output/metrics.json` and `evaluation-output/report.md`. VM A/B suites stored in the same fixture directory are recognized and skipped by this offline evaluator instead of causing a schema crash.

Run a live OpenClaw comparison with explicitly named profiles:

```bash
python scripts/run_vm_openclaw_ab.py \
  --suite fixtures/vm-ab-short-realistic.json \
  --baseline-profile baseline \
  --treatment-profile treatment \
  --openclaw-command openclaw
```

The live runner writes incremental results under `evaluation-output/vm-ab` by default and accepts a custom output root.

## Development

```bash
npm ci
npm run check
```

`npm run check` verifies the public boundary, compiles TypeScript, runs the real `node:test` suite, and executes the offline evaluator. `npm audit` can be used for a dependency audit.

## Security model and limitations

- Missing or invalid session identity, invalid runtime input, oversized policy input, and internal policy errors all preserve full context.
- Observability and persistence failures are returned as warnings and do not break the reply path.
- User or tool content is never copied into a system-level policy notice.
- Enforcement is heuristic. It should not be enabled for safety-critical workloads without workload-specific validation.
- State-file persistence is single-process and unencrypted. Do not share one state file between multiple gateway processes.
- ContextGate does not claim transcript compaction ownership. It makes non-destructive assembly decisions; use the OpenClaw legacy engine when model-driven transcript compaction is required.

See [Architecture](docs/architecture.md) for the policy pipeline and safety invariants.
