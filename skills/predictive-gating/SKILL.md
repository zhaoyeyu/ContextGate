---
name: predictive-gating
description: Think in structured deltas so unchanged state can remain implicit when predictive gating is active.
---

# Predictive Gating

Use this skill when a task is continuing across turns and the next action might depend only on what changed.

Before asking for or consuming a full context rebuild, answer:

1. What actually changed since the prior state?
2. Does the change alter the likely next action distribution?
3. Which state fields changed: goal, constraints, plan, open questions, facts, tool state, risk, or confidence?
4. Can unchanged state remain implicit without losing globally relevant evidence?
5. Is this a research reinterpretation, safety-critical, or conflict-heavy turn that needs conservative refresh?

Prefer delta injection when the new information only changes a local action. Prefer broader refresh when risk, contradiction, user correction, or dissatisfaction is present.

Do not hide correctness checks. Token savings are only valid when the task can still be completed to the same quality bar.
