import { resolveConfig } from "./config.js";
import { estimateTokens } from "./delta-encoder.js";
import { GatingEngine } from "./gating-engine.js";
import { objectSchema, stringSchema, type OpenClawPluginApi } from "./host-adapter.js";
import type { ConversationMode, GateInput, TaskType } from "./types.js";

const pluginId = "openclaw-plugin-predictive-gating";

export default function register(api: OpenClawPluginApi): void {
  const config = resolveConfig(api.config);
  const engine = new GatingEngine(undefined, config);

  api.registerContextEngine?.("predictive-gating", () => ({
    info: { id: "predictive-gating", name: "Predictive Gating", ownsCompaction: true },
    async ingest() {
      return { ingested: true };
    },
    async assemble(input) {
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const lastText = extractLastText(messages);
      const sessionId = readString(input.sessionId) ?? readString(input.threadId) ?? "default";
      const fullContextTokenEstimate = estimateTokens(JSON.stringify(messages));
      const result = await engine.process({
        sessionId,
        text: lastText,
        taskType: readTaskType(input.taskType) ?? config.defaultProfile,
        conversationMode: readConversationMode(input.conversationMode) ?? "default",
        fullContextTokenEstimate
      });

      if (result.decision === "request_full_refresh") {
        return { messages, estimatedTokens: fullContextTokenEstimate, gating: result.record };
      }

      return {
        messages: [{ role: "system", content: result.injectedContext }, ...messages.slice(-1)],
        estimatedTokens: estimateTokens(result.injectedContext) + estimateTokens(lastText),
        gating: result.record
      };
    },
    async compact() {
      return { ok: true, compacted: false, reason: "predictive gating stores structured state instead of summarizing raw history" };
    }
  }));

  api.registerTool?.({
    name: "predictive_gating_inspect",
    description: "Inspect predictive gating structured state and recent gating decisions for a session.",
    parameters: objectSchema({ sessionId: stringSchema("Optional session id. If omitted, returns all in-memory sessions.") }),
    async execute(_id, params) {
      return textResult(JSON.stringify(engine.inspect(readString(params.sessionId)), null, 2));
    }
  });

  api.registerTool?.({
    name: "predictive_gating_record_feedback",
    description: "Record user correction or dissatisfaction so the fallback auditor can recover from bad gating.",
    parameters: objectSchema(
      {
        sessionId: stringSchema("Session id."),
        feedback: stringSchema("Correction, dissatisfaction, or other feedback text.")
      },
      ["sessionId", "feedback"]
    ),
    async execute(_id, params) {
      const gateInput: GateInput = {
        sessionId: readString(params.sessionId) ?? "default",
        text: readString(params.feedback) ?? "",
        taskType: config.defaultProfile,
        conversationMode: "debug"
      };
      const result = await engine.process(gateInput);
      return textResult(JSON.stringify(result.record, null, 2));
    }
  });

  api.registerCommand?.({
    name: "predictive-gating-inspect",
    description: "Show predictive gating state for a session.",
    acceptsArgs: true,
    async handler(ctx) {
      const sessionId = parseSessionId(ctx.args);
      return { text: JSON.stringify(engine.inspect(sessionId), null, 2) };
    }
  });

  api.registerService?.({
    id: pluginId,
    name: "Predictive Gating Observability",
    async start() {
      api.log?.info?.("Predictive gating service started", { enabled: config.enabled, defaultProfile: config.defaultProfile });
    },
    async stop() {
      api.log?.info?.("Predictive gating service stopped");
    }
  });
}

function extractLastText(messages: unknown[]): string {
  const last = messages.at(-1);
  if (typeof last === "string") return last;
  if (typeof last !== "object" || last === null) return "";
  const content = (last as Record<string, unknown>).content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTaskType(value: unknown): TaskType | undefined {
  return value === "workflow_local_delta" ||
    value === "coding_iterative" ||
    value === "research_global_reinterpretation" ||
    value === "safety_critical"
    ? value
    : undefined;
}

function readConversationMode(value: unknown): ConversationMode | undefined {
  return value === "default" || value === "review" || value === "planning" || value === "execution" || value === "debug"
    ? value
    : undefined;
}

function parseSessionId(args: string | undefined): string | undefined {
  if (!args) return undefined;
  const match = args.match(/(?:^|\s)sessionId=([^\s]+)/);
  return match?.[1];
}
