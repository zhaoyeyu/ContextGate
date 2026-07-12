export interface OpenClawToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface OpenClawContextEngine {
  info: {
    id: string;
    name: string;
    version?: string;
    ownsCompaction?: boolean;
    hostRequirements?: Record<string, unknown>;
  };
  ingest: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  assemble: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  compact: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface OpenClawCommandContext {
  args?: string;
  channel?: string;
  params?: Record<string, unknown>;
}

export interface OpenClawCommandDefinition {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: OpenClawCommandContext) => Promise<unknown> | unknown;
}

export interface OpenClawPluginApi {
  config?: unknown;
  registerTool?: (tool: OpenClawToolDefinition, options?: Record<string, unknown>) => void;
  registerContextEngine?: (id: string, factory: () => OpenClawContextEngine) => void;
  registerCommand?: (command: OpenClawCommandDefinition) => void;
  registerService?: (service: Record<string, unknown>) => void;
  log?: {
    info?: (message: string, fields?: Record<string, unknown>) => void;
    warn?: (message: string, fields?: Record<string, unknown>) => void;
  };
}

export const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required
});

export const stringSchema = (description?: string): Record<string, unknown> => ({
  type: "string",
  ...(description ? { description } : {})
});

export const booleanSchema = (description?: string): Record<string, unknown> => ({
  type: "boolean",
  ...(description ? { description } : {})
});
