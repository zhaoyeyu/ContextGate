# Predictive Gating A/B Benchmark

The benchmark compares predictive gating with a full-refresh baseline across short and long context sessions.

## Suites

### Short Regression Suite

`fixtures/vm-ab-short-realistic.json`

- Three two-turn cases.
- Intended for installation checks and fast regression testing.
- Covers local workflow updates, coding iteration, and conclusion updates after new evidence.

### Long Context Suite

`fixtures/vm-ab-long-context-realistic.json`

- Five multi-turn cases.
- Measures token use as goals, constraints, evidence, and tool results accumulate.
- Covers drafting, research, financial analysis, debugging, and plugin compatibility work.

### Focused Long Context Suite

`fixtures/vm-ab-long-context-phase1.json`

- A smaller multi-turn subset for faster iteration.
- Exercises drafting and coding workflows where local deltas accumulate.

## Run

Use repository-relative paths and explicit OpenClaw profile names:

```bash
python3 scripts/run_vm_openclaw_ab.py \
  --suite fixtures/vm-ab-long-context-realistic.json \
  --baseline-profile baseline \
  --treatment-profile treatment \
  --openclaw-command openclaw
```

For the short suite:

```bash
python3 scripts/run_vm_openclaw_ab.py \
  --suite fixtures/vm-ab-short-realistic.json \
  --baseline-profile baseline \
  --treatment-profile treatment \
  --openclaw-command openclaw
```

## Metrics

Primary metrics:

- total tokens
- input tokens
- duration

Quality checks:

- task success proxy
- fallback escalations
- false positive and false negative rates
- semantic drift or degraded final output
- action distribution divergence from the baseline
