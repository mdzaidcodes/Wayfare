import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerDeps } from "./context";
import { createExperiencesServer } from "./servers/experiences";
import { createFlightsServer } from "./servers/flights";
import { createReferenceServer } from "./servers/reference";
import { createStaysServer } from "./servers/stays";

// The app is the MCP client. Each planning run gets its own set of servers (bound to that run's
// guard and progress stream), connected in-process.

export type ServerName = "reference" | "flights" | "stays" | "experiences";

export interface McpHost {
  clients: Record<ServerName, Client>;
  close(): Promise<void>;
}

const FACTORIES: Record<ServerName, (d: ServerDeps) => McpServer> = {
  reference: createReferenceServer,
  flights: createFlightsServer,
  stays: createStaysServer,
  experiences: createExperiencesServer,
};

export async function createMcpHost(deps: ServerDeps): Promise<McpHost> {
  const servers: McpServer[] = [];
  const clients = {} as Record<ServerName, Client>;
  for (const name of Object.keys(FACTORIES) as ServerName[]) {
    const server = FACTORIES[name](deps);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: `wayfare-${name}-client`, version: "0.1.0" });
    await client.connect(clientT);
    servers.push(server);
    clients[name] = client;
  }
  return {
    clients,
    async close() {
      await Promise.allSettled([...Object.values(clients).map((c) => c.close()), ...servers.map((s) => s.close())]);
    },
  };
}
