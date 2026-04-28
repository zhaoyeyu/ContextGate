# openclaw-plugin-predictive-gating

Native OpenClaw context-engine plugin for predictive token gating. It keeps structured task/session state, predicts the expected next update, encodes observed input as a delta, values the delta, and chooses one of `absorb`, `inject_delta`, `request_partial_refresh`, or `request_full_refresh`.

The goal is to reduce average token use by avoiding redundant context rebuilds and redundant re-reasoning on suitable workloads. It does not try to win by summarizing everything, removing globally relevant evidence, or skipping correctness checks.

## Install

```bash
npm install
npm run build
openclaw plugins install .
openclaw plugins enable openclaw-plugin-predictive-gating
```

Example config:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "openclaw-plugin-predictive-gating"
    },
    "entries": {
      "openclaw-plugin-predictive-gating": {
        "enabled": true,
        "defaultProfile": "coding_iterative",
        "logPath": ".openclaw/predictive-gating.jsonl"
      }
    }
  }
}
```

OpenClaw host APIs evolve, so runtime integration is isolated in `src/host-adapter.ts` and `src/index.ts`. The policy engine and evaluation harness are host-independent.

## Configuration

The manifest contains the inline `configSchema`. Tunable conservatism lives in `profiles`:

- `workflow_local_delta`: most permissive for repetitive workflows.
- `coding_iterative`: balanced for edit/test/debug loops.
- `research_global_reinterpretation`: conservative because evidence can change global interpretation.
- `safety_critical`: most conservative; low risk or conflict thresholds force refresh.

Thresholds:

- `absorbMaxActionRelevance`: maximum action relevance eligible for absorb.
- `absorbMaxPredictionError`: maximum prediction error eligible for absorb.
- `injectMaxRiskDelta`: maximum risk eligible for delta-only injection.
- `partialRefreshConflict`: conflict threshold for partial refresh.
- `fullRefreshRisk`: risk threshold for full refresh.
- `fullRefreshConflict`: conflict threshold for full refresh.
- `minConfidenceToGate`: below this, force full refresh.

## Runtime Surfaces

The plugin registers a context engine, two diagnostic tools, an optional slash-command-compatible command, a lightweight service, and one skill.

- Context engine: `predictive-gating`
- Tool: `predictive_gating_inspect`
- Tool: `predictive_gating_record_feedback`
- Command: `predictive-gating-inspect` when the host exposes `registerCommand`
- Skill: `skills/predictive-gating/SKILL.md`

Diagnostic method:

```text
/predictive-gating-inspect sessionId=<id>
```

If slash-command registration is unavailable in the installed host version, call the `predictive_gating_inspect` tool.

## Observability

Each turn can be logged as JSONL with schema version `predictive-gating.v1`. Records include estimated full-context tokens avoided, gating decision, delta size, fallback status, task type, confidence before/after, valuation scores, and the structured delta.

## Evaluation

Run the A/B simulation harness:

```bash
npm run evaluate
```

It writes `evaluation-output/metrics.json` and `evaluation-output/report.md`. Metrics include input/output/total tokens, latency, task success proxy, fallback escalations, false positive/negative rate, and action distribution divergence versus baseline.

## Development

```bash
npm install
npm test
```

Unit tests cover delta classification and gating policy. Simulation tests cover all four task classes. Regression tests verify fallback recovery on bad gating cases.
