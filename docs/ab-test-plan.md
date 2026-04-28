# Predictive Gating A/B Plan

## Assessment of the first suite

The first VM suite was a valid smoke test, but it was not yet a realistic proxy for sustained OpenClaw usage.

What it did well:

- It verified that baseline and treatment could both run against the same model and workspace.
- It covered three plugin-relevant modes:
  - local workflow edits
  - coding iteration
  - global reinterpretation after new evidence
- It was cheap enough to validate installation and prompt-building behavior without burning much provider budget.

Where it was weak:

- Every case was only two turns long.
- It did not model continuing task state across many turns.
- It did not include repeated constraint changes, deleted requirements, or corrective loops.
- It did not cover some realistic domains the plugin should help with:
  - article drafting
  - research memo evolution
  - financial analysis reforecasting
  - agent development debugging
  - plugin development compatibility work

That means the first suite was good for proving the harness works, but it likely underestimates token savings. Predictive gating should help more once the unchanged state inside a session becomes much larger than the newest delta.

## Why longer sessions matter for this plugin

The plugin is designed to avoid sending full raw history into the main reasoning path when only a local delta matters. In short sessions, the baseline prompt is still small, so the upside from gating is muted. In longer sessions:

- the accumulated plan grows
- constraints accumulate
- evidence piles up
- previous tool results stay relevant
- only a small fraction of each new turn actually changes the next action

That is exactly where the delta-based context engine should pull away from a legacy full-refresh baseline.

## Recommended suite structure

Use two suites:

1. `fixtures/vm-ab-short-realistic.json`

- Purpose: cheap regression and install smoke test
- Length: 3 cases x 2 turns
- Good for: quick validation after code changes

2. `fixtures/vm-ab-long-context-realistic.json`

- Purpose: realistic A/B signal for token savings
- Length: 5 cases x 8-10 turns
- Good for:
  - article drafting and reframing
  - research report reinterpretation
  - financial analysis reforecasting
  - agent development debug loops
  - plugin development compatibility iteration

## How to run in the VM

The VM script now accepts a suite file:

```bash
python3 /home/benjamin/ab-tests/run_vm_openclaw_ab.py --suite /home/benjamin/ab-tests/fixtures/vm-ab-long-context-realistic.json
```

Or for the short smoke suite:

```bash
python3 /home/benjamin/ab-tests/run_vm_openclaw_ab.py --suite /home/benjamin/ab-tests/fixtures/vm-ab-short-realistic.json
```

## What to look for

Primary metrics:

- total tokens
- input tokens
- duration

Secondary checks:

- whether treatment starts to save more on later turns than earlier turns
- whether research/global reinterpretation cases save less than local-delta cases
- whether any case shows semantic drift or degraded final quality

## Budget guidance

With a small remaining provider budget, run in this order:

1. short realistic suite after any code change
2. one or two long cases from the realistic suite
3. the full long suite only after the plugin behavior is stable
