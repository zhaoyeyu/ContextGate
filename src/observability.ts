import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ContentLoggingMode, DecisionRecord } from "./types.js";

export class ObservabilityLogger {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logPath?: string,
    private readonly contentMode: ContentLoggingMode = "metadata"
  ) {}

  async write(record: DecisionRecord): Promise<string | undefined> {
    if (!this.logPath) return undefined;
    const serialized = `${JSON.stringify(sanitizeRecord(record, this.contentMode))}\n`;
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.logPath!), { recursive: true });
      await appendFile(this.logPath!, serialized, { encoding: "utf8", mode: 0o600 });
    });
    this.writeQueue = operation.catch(() => undefined);
    try {
      await operation;
      return undefined;
    } catch (error) {
      return `decision logging failed (${errorCode(error)})`;
    }
  }
}

export function sanitizeRecord(record: DecisionRecord, mode: ContentLoggingMode): DecisionRecord {
  if (mode === "full") return structuredClone(record);
  return {
    ...structuredClone(record),
    session_id: hashIdentifier(record.session_id),
    turn_id: hashIdentifier(record.turn_id),
    delta: {
      ...record.delta,
      summary: `${record.delta.kind} update affecting ${record.delta.affectedFields.join(", ") || "no state fields"}`,
      evidence: [],
      localEvidence: undefined
    }
  };
}

function hashIdentifier(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}
