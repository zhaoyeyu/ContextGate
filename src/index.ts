import { resolveConfig } from "./config.js";
import { estimateTokens } from "./delta-encoder.js";
import { GatingEngine } from "./gating-engine.js";
import { booleanSchema, objectSchema, stringSchema, type OpenClawPluginApi } from "./host-adapter.js";
import type { ConversationMode, GateInput, TaskType } from "./types.js";

export const pluginId = "openclaw-plugin-predictive-gating";
const pluginVersion = "0.2.0";

export default function register(api: OpenClawPluginApi): void {
  const config = resolveConfig(api.config);
  const engine = new GatingEngine(undefined, config);

  api.registerContextEngine?.(pluginId, () => ({
    info: {
      id: pluginId,
      name: "ContextGate",
      version: pluginVersion,
      ownsCompaction: false,
      hostRequirements: {
        "agent-run": {
          requiredCapabilities: ["assemble-before-prompt"],
          unsupportedMessage: "Select the legacy context engine for runtimes that cannot assemble before prompting."
        }
      }
    },
    async ingest(input) {
      return {
        ingested: true,
        sessionId: readSessionId(input),
        policyStorage: "structured-delta"
      };
    },
    async assemble(input) {
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const sessionId = readSessionId(input);
      const fullContextTokenEstimate = estimateMessageTokens(messages);

      if (!sessionId) {
        return {
          messages,
          estimatedTokens: fullContextTokenEstimate,
          gating: {
            bypassed: true,
            reason: "missing session identifier",
            appliedDecision: "request_full_refresh"
          }
        };
      }

      const observed = extractLatestUpdate(messages);
      if (observed.bypassReason) {
        return {
          messages,
          estimatedTokens: fullContextTokenEstimate,
          gating: {
            bypassed: true,
            reason: observed.bypassReason,
            appliedDecision: "request_full_refresh"
          }
        };
      }
      const result = await engine.process({
        sessionId,
        turnId: readString(input.turnId) ?? readString(input.runId),
        text: observed.text,
        taskType: readTaskType(input.taskType),
        conversationMode: readConversationMode(input.conversationMode),
        fullContextTokenEstimate,
        observedToolName: observed.toolName,
        observedToolResult: observed.toolResult
      });

      const selectedMessages =
        result.decision === "absorb" || result.decision === "inject_delta"
          ? selectEnforcedMessages(messages, config.preserveRecentMessages)
          : messages;

      return {
        messages: selectedMessages,
        estimatedTokens: estimateMessageTokens(selectedMessages),
        ...(result.injectedContext ? { systemPromptAddition: result.injectedContext } : {}),
        gating: result.record
      };
    },
    async compact() {
      return {
        ok: true,
        compacted: false,
        reason: "ContextGate is non-destructive and does not claim transcript compaction ownership."
      };
    }
  }));

  api.registerTool?.({
    name: "predictive_gating_inspect",
    description: "Inspect a redacted ContextGate state and recent policy decisions for one session.",
    parameters: objectSchema(
      {
        sessionId: stringSchema("Session id to inspect."),
        includeSensitive: booleanSchema(
          "Request raw state content. Honored only when allowSensitiveDiagnostics is enabled."
        )
      },
      ["sessionId"]
    ),
    async execute(_id, params) {
      const sessionId = requireString(params.sessionId, "sessionId");
      const inspected = engine.inspect(sessionId, params.includeSensitive === true);
      return textResult(JSON.stringify(inspected ?? { found: false, sessionId }, null, 2));
    }
  });

  api.registerTool?.({
    name: "predictive_gating_record_feedback",
    description: "Record correction or dissatisfaction feedback for an existing ContextGate session.",
    parameters: objectSchema(
      {
        sessionId: stringSchema("Session id."),
        feedback: stringSchema("Correction, dissatisfaction, or other feedback text.")
      },
      ["sessionId", "feedback"]
    ),
    async execute(_id, params) {
      const sessionId = requireString(params.sessionId, "sessionId");
      if (!engine.inspect(sessionId)) throw new Error(`ContextGate session not found: ${sessionId}`);
      const gateInput: GateInput = {
        sessionId,
        text: requireString(params.feedback, "feedback"),
        conversationMode: "debug"
      };
      const result = await engine.process(gateInput);
      return textResult(JSON.stringify(result.record, null, 2));
    }
  });

  api.registerCommand?.({
    name: "predictive-gating-inspect",
    description: "Show redacted ContextGate state for one session.",
    acceptsArgs: true,
    async handler(ctx) {
      const sessionId = parseSessionId(ctx.args);
      if (!sessionId) return { text: "Usage: /predictive-gating-inspect sessionId=<id>" };
      return { text: JSON.stringify(engine.inspect(sessionId), null, 2) };
    }
  });

  api.registerService?.({
    id: pluginId,
    name: "ContextGate Policy Diagnostics",
    async start() {
      api.log?.info?.("ContextGate service started", {
        enabled: config.enabled,
        operationMode: config.operationMode,
        defaultProfile: config.defaultProfile
      });
    },
    async stop() {
      api.log?.info?.("ContextGate service stopped");
    }
  });
}

interface LatestUpdate {
  text: string;
  toolName?: string;
  toolResult?: unknown;
  bypassReason?: string;
}

function extractLatestUpdate(messages: unknown[]): LatestUpdate {
  const last = messages.at(-1);
  if (isMessage(last) && last.role === "tool") {
    return {
      text: extractContentText(last.content),
      toolName: readString(last.name) ?? readString(last.toolName),
      toolResult: last.content
    };
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isMessage(message) && message.role === "user") {
      return {
        text: extractContentText(message.content),
        bypassReason: hasUnsupportedUserContent(message.content)
          ? "non-text user content requires complete context"
          : undefined
      };
    }
    if (typeof message === "string") return { text: message };
  }
  return { text: "" };
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content ?? "");
  } catch {
    return "[unserializable message content]";
  }
}

function selectEnforcedMessages(messages: unknown[], recentCount: number): unknown[] {
  if (messages.length <= recentCount) return messages;
  const selected = new Set<number>();
  for (const [index, message] of messages.entries()) {
    if (isMessage(message) && (message.role === "system" || message.role === "developer")) selected.add(index);
  }
  let tailStart = Math.max(0, messages.length - recentCount);
  while (tailStart > 0) {
    const message = messages[tailStart];
    if (!isMessage(message) || message.role !== "tool") break;
    tailStart -= 1;
  }
  for (let index = tailStart; index < messages.length; index += 1) selected.add(index);

  const indexes = [...selected].sort((left, right) => left - right);
  return indexes.map((index) => messages[index]);
}

function estimateMessageTokens(messages: unknown[]): number {
  try {
    return estimateTokens(JSON.stringify(messages));
  } catch {
    return messages.reduce<number>((total, message) => total + estimateTokens(extractContentText(message)), 0);
  }
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function readSessionId(input: Record<string, unknown>): string | undefined {
  return readString(input.sessionId) ?? readString(input.sessionKey) ?? readString(input.threadId);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireString(value: unknown, name: string): string {
  const parsed = readString(value);
  if (!parsed) throw new TypeError(`${name} must be a non-empty string`);
  return parsed;
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

function isMessage(value: unknown): value is Record<string, unknown> & { role: string } {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).role === "string";
}

function hasUnsupportedUserContent(content: unknown): boolean {
  if (typeof content === "string") return false;
  if (!Array.isArray(content)) return content !== undefined && content !== null;
  return content.some((part) => {
    if (typeof part === "string") return false;
    if (typeof part !== "object" || part === null) return true;
    const item = part as Record<string, unknown>;
    return typeof item.text !== "string" ||
      (typeof item.type === "string" && item.type !== "text" && item.type !== "input_text");
  });
}
