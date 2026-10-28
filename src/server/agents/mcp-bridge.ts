import "server-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { MCPServer, CallToolResultContent } from "@openai/agents";

type MCPTool = Awaited<ReturnType<MCPServer["listTools"]>>[number];

// Adapts an official-SDK MCP Client (connected in-process to one of Wayfare's MCP servers) to the
// Agents SDK's MCPServer interface, with a per-agent tool allowlist.

export class InProcessMcpServer implements MCPServer {
  cacheToolsList = true;
  useStructuredContent = true;
  private cached?: MCPTool[];

  constructor(
    readonly name: string,
    private readonly client: Client,
    private readonly allowed: readonly string[],
    private readonly onCall?: (tool: string, args: Record<string, unknown> | null) => void,
  ) {}

  async connect() {}
  async close() {}

  async listTools(): Promise<MCPTool[]> {
    if (this.cached) return this.cached;
    const { tools } = await this.client.listTools();
    this.cached = tools
      .filter((t) => this.allowed.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: "object" as const,
          properties: (t.inputSchema.properties ?? {}) as Record<string, unknown>,
          required: (t.inputSchema.required ?? []) as string[],
          additionalProperties: false,
        },
      }));
    return this.cached;
  }

  async callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent> {
    if (!this.allowed.includes(toolName)) {
      return [{ type: "text", text: JSON.stringify({ error: `Tool ${toolName} is not allowed for this agent.` }) }] as CallToolResultContent;
    }
    this.onCall?.(toolName, args);
    const r = await this.client.callTool({ name: toolName, arguments: args ?? {} }, undefined, { timeout: 180_000 });
    // Structured JSON is what the model reads; it never contains provider descriptions or reviews.
    const text = r.structuredContent ? JSON.stringify(r.structuredContent) : JSON.stringify(r.content);
    return [{ type: "text", text }] as CallToolResultContent;
  }

  async invalidateToolsCache() {
    this.cached = undefined;
  }
}
