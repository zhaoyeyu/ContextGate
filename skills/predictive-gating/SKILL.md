---
name: predictive-gating
description: Use ContextGate decision explanations to reason about structured updates without hiding correctness checks.
---

# Predictive Gating

Use this skill when a task is continuing across turns and the next action might depend only on what changed.

Before asking for or consuming a full context rebuild, answer:

1. What actually changed since the prior state?
2. Does the change alter the likely next action distribution?
3. Which state fields changed: goal, constraints, plan, open questions, facts, tool state, risk, or confidence?
4. Can unchanged state remain implicit without losing globally relevant evidence?
5. Is this a research reinterpretation, safety-critical, or conflict-heavy turn that needs conservative refresh?

Treat the recorded recommendation as advisory when `operationMode` is `observe`. Prefer delta injection only when the active rule explains why the update is local and low risk. Prefer broader refresh when risk, contradiction, user correction, dissatisfaction, or missing session identity is present.

Do not hide correctness checks. Token savings are only valid when the task can still be completed to the same quality bar.
