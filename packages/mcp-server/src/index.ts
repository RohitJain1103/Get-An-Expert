#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_VERSION } from "./config";
import { buildServer } from "./server";

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries JSON-RPC; all logging goes to stderr.
  console.error(`[get-an-expert] MCP server v${SERVER_VERSION} ready (stdio)`);
}

main().catch((error) => {
  console.error("[get-an-expert] fatal:", error);
  process.exit(1);
});
