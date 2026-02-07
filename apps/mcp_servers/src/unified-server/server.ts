// =============================================================================
// MCP Server
// =============================================================================
// Unified MCP server with dynamic tool routing

import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { toolRouter } from './router/index.js';
import {
  metaToolSchemas,
  metaToolHandlers,
} from './router/meta-tools.js';
import { handleClaudeCode } from './tools/claude-code/index.js';
import { registerAllTools, cleanupTools } from './tools/index.js';
import { getConfig } from './config.js';
import { log } from './utils/logger.js';

/**
 * MCP Server class
 *
 * Provides a unified MCP server that exposes:
 * - 5 meta-tools for dynamic tool access (list, get_schema, execute, suggest, claude_code)
 * - All registered tools accessible via execute_tool
 */
export class MCPServer {
  private httpServer: ReturnType<typeof serve> | null = null;

  constructor() {
    // Register all tools with the router
    registerAllTools();
  }

  /**
   * Start the HTTP server with Streamable HTTP transport
   */
  async start(): Promise<void> {
    const config = getConfig();
    const { port, host } = config.server;

    // Create Hono app for HTTP handling
    const app = new Hono();

    // Health check endpoint
    app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        server: 'jarvis-unified-mcp',
        version: '1.0.0',
        tools: toolRouter.getToolCount(),
      });
    });

    // MCP endpoint using Streamable HTTP
    app.post('/mcp', async (c) => {
      try {
        const body = await c.req.json();
        
        log.debug('MCP request received', { method: body.method });

        // Handle the request through the MCP server
        // For Streamable HTTP, we process JSON-RPC requests directly
        const response = await this.handleJsonRpcRequest(body);

        if (response === null) {
          // Notification - no response needed
          return c.json({ jsonrpc: '2.0', result: {} });
        }

        return c.json(response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('MCP request error', { error: errorMessage });

        return c.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: errorMessage,
          },
        }, 500);
      }
    });

    // Start HTTP server
    this.httpServer = serve({
      fetch: app.fetch,
      port,
      hostname: host,
    });

    log.info(`MCP Server started on http://${host}:${port}`);
    log.info(`MCP endpoint: http://${host}:${port}/mcp`);
    log.info(`Health check: http://${host}:${port}/health`);
    log.info(`Registered tools: ${toolRouter.getToolCount()}`);
  }

  /**
   * Handle JSON-RPC request manually for Streamable HTTP
   */
  private async handleJsonRpcRequest(request: {
    jsonrpc: string;
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
  }): Promise<unknown> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'jarvis-unified-mcp',
                version: '1.0.0',
              },
              capabilities: {
                tools: {},
              },
            },
          };
        }

        case 'tools/list': {
          const tools = metaToolSchemas.map((schema) => ({
            name: schema.name,
            description: schema.description,
            inputSchema: schema.inputSchema,
          }));

          return {
            jsonrpc: '2.0',
            id,
            result: { tools },
          };
        }

        case 'tools/call': {
          const name = params?.name as string;
          const args = params?.arguments as unknown;

          log.info('Tool call', { tool: name });

          let result;

          // Check if it's a meta-tool
          if (name in metaToolHandlers) {
            result = await metaToolHandlers[name](args);
          } else if (name === 'claude_code') {
            result = await handleClaudeCode(args);
          } else {
            result = {
              content: [{
                type: 'text',
                text: `Unknown tool: ${name}. Use list_available_tools to discover available tools.`,
              }],
              isError: true,
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            result,
          };
        }

        case 'notifications/initialized': {
          // Client initialized notification - no response needed
          return null;
        }

        default: {
          log.warn('Unknown method', { method });
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('JSON-RPC error', { method, error: errorMessage });

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    log.info('Stopping MCP Server');

    // Cleanup tools
    await cleanupTools();

    // Close HTTP server
    if (this.httpServer) {
      // The @hono/node-server doesn't expose a direct close method
      // In production, you'd handle this with proper signal handling
      this.httpServer = null;
    }

    log.info('MCP Server stopped');
  }
}
