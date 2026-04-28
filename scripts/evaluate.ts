import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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

for (const fixture of await loadFixtures(fixturesDir)) {
  metrics.push(await evaluateFixture(fixture));
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
await writeFile(join(outDir, "report.md"), renderReport(metrics), "utf8");

async function evaluateFixture(fixture: Fixture): Promise<Metrics> {
  const engine = new GatingEngine();
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
    success += turn.expectedSuccess && result.decision !== "absorb" ? 1 : turn.expectedSuccess ? 0.8 : 0.4;

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

async function loadFixtures(dir: string): Promise<Fixture[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8")) as Fixture));
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
