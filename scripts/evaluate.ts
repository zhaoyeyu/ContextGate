import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { resolveConfig } from "../src/config.js";
import { GatingEngine } from "../src/gating-engine.js";
import type { GatingDecision, TaskType } from "../src/types.js";

interface FixtureTurn {
  text: string;
  baselineDecision: GatingDecision;
  expectedSuccess: boolean;
}

interface Fixture {
  name: string;
  taskType: TaskType;
  turns: FixtureTurn[];
}

interface Metrics {
  fixture: string;
  taskType: TaskType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  taskSuccessProxy: number;
  fallbackEscalations: number;
  gatingFalseNegativeRate: number;
  gatingFalsePositiveRate: number;
  actionDistributionDivergence: number;
}

const args = process.argv.slice(2);
const fixturesDir = readArg("--fixtures", "fixtures");
const outDir = readArg("--out", "evaluation-output");
const metrics: Metrics[] = [];

const { fixtures, skipped } = await loadFixtures(fixturesDir);
if (fixtures.length === 0) throw new Error(`No policy fixtures found in ${fixturesDir}`);
for (const file of skipped) console.warn(`skip - ${file} uses the VM A/B suite format`);
for (const fixture of fixtures) {
  metrics.push(await evaluateFixture(fixture));
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
await writeFile(join(outDir, "report.md"), renderReport(metrics), "utf8");

async function evaluateFixture(fixture: Fixture): Promise<Metrics> {
  const engine = new GatingEngine(undefined, resolveConfig({ operationMode: "enforce" }));
  const start = performance.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let success = 0;
  let fallbackEscalations = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let divergence = 0;

  for (const [index, turn] of fixture.turns.entries()) {
    const baselineTokens = estimateTokens(turn.text) + 1500;
    const result = await engine.process({
      sessionId: fixture.name,
      turnId: `${fixture.name}-${index}`,
      text: turn.text,
      taskType: fixture.taskType,
      fullContextTokenEstimate: baselineTokens
    });
    inputTokens += baselineTokens - result.record.estimated_full_context_tokens_avoided;
    outputTokens += estimateOutputTokens(result.decision);
    fallbackEscalations += result.record.fallback_triggered ? 1 : 0;
    success += turn.expectedSuccess ? 1 - decisionDistance(turn.baselineDecision, result.decision) * 0.25 : 0.4;

    const baselineRefresh = isRefresh(turn.baselineDecision);
    const treatmentRefresh = isRefresh(result.decision);
    if (treatmentRefresh && !baselineRefresh) falsePositives += 1;
    if (!treatmentRefresh && baselineRefresh) falseNegatives += 1;
    divergence += decisionDistance(turn.baselineDecision, result.decision);
  }

  const count = fixture.turns.length || 1;
  return {
    fixture: fixture.name,
    taskType: fixture.taskType,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs: performance.now() - start,
    taskSuccessProxy: success / count,
    fallbackEscalations,
    gatingFalseNegativeRate: falseNegatives / count,
    gatingFalsePositiveRate: falsePositives / count,
    actionDistributionDivergence: divergence / count
  };
}

async function loadFixtures(dir: string): Promise<{ fixtures: Fixture[]; skipped: string[] }> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const fixtures: Fixture[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(join(dir, file), "utf8")) as unknown;
    if (isFixture(value)) fixtures.push(value);
    else if (isVmSuite(value)) skipped.push(file);
    else throw new TypeError(`Invalid fixture schema: ${file}`);
  }
  return { fixtures, skipped };
}

function isFixture(value: unknown): value is Fixture {
  if (!isRecord(value) || typeof value.name !== "string" || !isTaskType(value.taskType) || !Array.isArray(value.turns)) {
    return false;
  }
  return value.turns.every(
    (turn) =>
      isRecord(turn) &&
      typeof turn.text === "string" &&
      isDecision(turn.baselineDecision) &&
      typeof turn.expectedSuccess === "boolean"
  );
}

function isVmSuite(value: unknown): boolean {
  return isRecord(value) && typeof value.suite_id === "string" && Array.isArray(value.cases);
}

function isTaskType(value: unknown): value is TaskType {
  return value === "workflow_local_delta" ||
    value === "coding_iterative" ||
    value === "research_global_reinterpretation" ||
    value === "safety_critical";
}

function isDecision(value: unknown): value is GatingDecision {
  return value === "absorb" ||
    value === "inject_delta" ||
    value === "request_partial_refresh" ||
    value === "request_full_refresh";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderReport(metrics: Metrics[]): string {
  const rows = metrics
    .map(
      (item) =>
        `| ${item.fixture} | ${item.taskType} | ${item.totalTokens} | ${item.taskSuccessProxy.toFixed(2)} | ${item.fallbackEscalations} | ${item.gatingFalseNegativeRate.toFixed(2)} | ${item.gatingFalsePositiveRate.toFixed(2)} | ${item.actionDistributionDivergence.toFixed(2)} |`
    )
    .join("\n");
  return [
    "# Predictive Gating Evaluation",
    "",
    "| Fixture | Task Type | Total Tokens | Success Proxy | Fallbacks | FN Rate | FP Rate | Divergence |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    rows,
    ""
  ].join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateOutputTokens(decision: GatingDecision): number {
  switch (decision) {
    case "absorb":
      return 25;
    case "inject_delta":
      return 120;
    case "request_partial_refresh":
      return 260;
    case "request_full_refresh":
      return 500;
  }
}

function isRefresh(decision: GatingDecision): boolean {
  return decision === "request_partial_refresh" || decision === "request_full_refresh";
}

function decisionDistance(a: GatingDecision, b: GatingDecision): number {
  const order: GatingDecision[] = ["absorb", "inject_delta", "request_partial_refresh", "request_full_refresh"];
  return Math.abs(order.indexOf(a) - order.indexOf(b)) / (order.length - 1);
}

function readArg(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}
