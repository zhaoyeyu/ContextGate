# ContextGate Architecture

ContextGate separates policy recommendation from host enforcement. This makes it possible to measure a policy on real traffic before allowing it to remove history.

## Policy pipeline

1. The host adapter resolves a real `sessionId` or `sessionKey`. Missing identity bypasses optimization.
2. The delta encoder classifies the latest user or tool update and extracts a bounded structured representation.
3. The predictor estimates likely update kinds for the active workload profile.
4. The valuator scores prediction error, action relevance, risk, novelty, conflict, and compressibility.
5. The workspace gate matches one ordered policy rule and returns a decision, rule id, and reason.
6. The fallback auditor can escalate correction loops, dissatisfaction, and elevated-risk conflicts.
7. The operation mode decides whether the recommendation is merely observed or applied.
8. State and observability writers run with failure isolation; their errors become decision warnings.

## Safety invariants

- `observe` never reduces host-provided message history.
- `request_partial_refresh` and `request_full_refresh` preserve all host-provided messages.
- Missing session identity never falls back to a shared default session.
- Runtime configuration is bounded independently of manifest validation.
- Raw user and tool content is not promoted into `systemPromptAddition`.
- Metadata logging is the default, and session inspection is scoped and redacted.
- A policy exception returns a complete fail-safe record with `request_full_refresh`.
- Repeated processing of the same turn id and content is idempotent within a process.

## State lifecycle

Each session tracks goals, constraints, plans, questions, facts, tool-result shapes, risk, confidence, deltas, and decision history. In-memory storage is bounded by a session limit and idle TTL. Optional persistence writes a versioned snapshot through a temporary file followed by rename, so a process interruption does not leave a partially written target file.

Persistence intentionally remains opt-in because structured state can contain conversation content. It is suitable for a single gateway process. Cross-process locking, encryption, and key management are outside the current storage contract.

## Host integration

The registered context-engine id is the same as the manifest plugin id: `openclaw-plugin-predictive-gating`. The adapter accepts both current `sessionKey` and compatible `sessionId`/`threadId` fields. It detects tool-result turns separately from user turns.

When enforcement applies `absorb` or `inject_delta`, assembly retains system/developer messages and a bounded recent-message window. The policy notice contains only trusted classification metadata. Other decisions pass through the complete message list.

ContextGate reports `ownsCompaction: false` and does not claim that a no-op compact call rewrites the transcript. Operators who require model-generated transcript summaries should use an engine that explicitly owns that lifecycle.

## Extension points

The current predictor and valuator are deterministic and host-independent. Future implementations can replace either component with a learned model or domain-specific rule set while preserving the same safety boundary, explanation record, fixtures, and observation-first rollout.
