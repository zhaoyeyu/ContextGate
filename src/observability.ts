import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DecisionRecord } from "./types.js";

export class ObservabilityLogger {
  constructor(private readonly logPath?: string) {}

  async write(record: DecisionRecord): Promise<void> {
    if (!this.logPath) return;
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
