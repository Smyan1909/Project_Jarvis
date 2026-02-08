// =============================================================================
// MCP Tool Converter
// =============================================================================
// Utilities for converting between MCP tool schemas and our ToolDefinition format

import type {
  ToolDefinition,
  ToolParameters,
  ToolParameter,
  ToolResult,
  MCPTool,
  MCPToolResult,
} from '@project-jarvis/shared-types';

/**
 * Separator used between server name and tool name in tool IDs
 */
export const MCP_TOOL_SEPARATOR = '__';

/**
 * Convert an MCP tool to our ToolDefinition format
 *
 * @param mcpTool - Tool definition from MCP server
 * @param serverName - Name of the server (used as prefix for tool ID)
 * @returns ToolDefinition compatible with our system
 */
export function convertMCPToolToDefinition(
  mcpTool: MCPTool,
  serverName: string
): ToolDefinition {
  const toolId = `${serverName}${MCP_TOOL_SEPARATOR}${mcpTool.name}`;

  return {
    id: toolId,
    name: toolId, // Use full ID as name for consistency
    description: formatToolDescription(mcpTool, serverName),
    parameters: convertInputSchema(mcpTool.inputSchema),
  };
}

/**
 * Convert multiple MCP tools to ToolDefinitions
 */
export function convertMCPToolsToDefinitions(
  mcpTools: MCPTool[],
  serverName: string
): ToolDefinition[] {
  return mcpTools.map((tool) => convertMCPToolToDefinition(tool, serverName));
}

/**
 * Parse a tool ID to extract server name and original tool name
 *
 * @param toolId - Full tool ID (e.g., "github__create_issue")
 * @returns [serverName, toolName] or null if not a valid MCP tool ID
 */
export function parseToolId(toolId: string): [string, string] | null {
  const separatorIndex = toolId.indexOf(MCP_TOOL_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const serverName = toolId.substring(0, separatorIndex);
  const toolName = toolId.substring(separatorIndex + MCP_TOOL_SEPARATOR.length);

  if (!serverName || !toolName) {
    return null;
  }

  return [serverName, toolName];
}

/**
 * Check if a tool ID is from an MCP server
 */
export function isMCPToolId(toolId: string): boolean {
  return parseToolId(toolId) !== null;
}

/**
 * Format tool description with server info
 */
function formatToolDescription(mcpTool: MCPTool, serverName: string): string {
  const description = mcpTool.description || `Tool from ${serverName} MCP server`;
  return `[MCP: ${serverName}] ${description}`;
}

/**
 * Convert MCP JSON Schema input schema to our ToolParameters format
 *
 * MCP uses standard JSON Schema, which we need to convert to our
 * simplified ToolParameters format.
 */
function convertInputSchema(inputSchema: Record<string, unknown>): ToolParameters {
  // Handle empty or missing schema
  if (!inputSchema || Object.keys(inputSchema).length === 0) {
    return {
      type: 'object',
      properties: {},
    };
  }

  // MCP schemas should be objects
  const schemaType = inputSchema.type as string | undefined;
  if (schemaType !== 'object') {
    // Wrap non-object schemas
    return {
      type: 'object',
      properties: {
        input: convertSchemaProperty(inputSchema),
      },
      required: ['input'],
    };
  }

  const properties = (inputSchema.properties as Record<string, unknown>) || {};
  const required = (inputSchema.required as string[]) || [];

  const convertedProperties: Record<string, ToolParameter> = {};

  for (const [key, value] of Object.entries(properties)) {
    convertedProperties[key] = convertSchemaProperty(value as Record<string, unknown>);
  }

  return {
    type: 'object',
    properties: convertedProperties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Convert a single JSON Schema property to ToolParameter
 */
function convertSchemaProperty(schema: Record<string, unknown>): ToolParameter {
  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;
  const enumValues = schema.enum as string[] | undefined;

  switch (type) {
    case 'string':
      return {
        type: 'string',
        description,
        enum: enumValues,
      };

    case 'number':
    case 'integer':
      return {
        type: 'number',
        description,
      };

    case 'boolean':
      return {
        type: 'boolean',
        description,
      };

    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined;
      return {
        type: 'array',
        description,
        items: items ? convertSchemaProperty(items) : { type: 'string' },
      };
    }

    case 'object': {
      const properties = schema.properties as Record<string, unknown> | undefined;
      const required = schema.required as string[] | undefined;
      const additionalProperties = schema.additionalProperties as boolean | Record<string, unknown> | undefined;

      if (properties) {
        const convertedProps: Record<string, ToolParameter> = {};
        for (const [key, value] of Object.entries(properties)) {
          convertedProps[key] = convertSchemaProperty(value as Record<string, unknown>);
        }
        return {
          type: 'object',
          description,
          properties: convertedProps,
          required,
          additionalProperties: additionalProperties === true ? true : undefined,
        };
      }

      // For objects with no properties but additionalProperties: true (dynamic object)
      if (additionalProperties === true) {
        return {
          type: 'object',
          description,
          additionalProperties: true,
        };
      }

      return {
        type: 'object',
        description,
      };
    }

    default:
      // Default to string for unknown types
      return {
        type: 'string',
        description,
      };
  }
}

/**
 * Convert MCP tool result to our ToolResult format
 */
export function convertMCPToolResult(mcpResult: MCPToolResult): ToolResult {
  // Extract text content from the result
  const textContents = mcpResult.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string);

  // If there's only text content, simplify the output
  if (textContents.length > 0 && mcpResult.content.every((c) => c.type === 'text')) {
    const output = textContents.length === 1 ? textContents[0] : textContents;
    return {
      success: !mcpResult.isError,
      output,
      error: mcpResult.isError ? textContents.join('\n') : undefined,
    };
  }

  // For mixed content types, return the full content array
  return {
    success: !mcpResult.isError,
    output: mcpResult.content,
    error: mcpResult.isError
      ? textContents.join('\n') || 'Tool execution failed'
      : undefined,
  };
}

/**
 * Normalize a server name for use in tool IDs
 *
 * Removes special characters and converts to lowercase
 */
export function normalizeServerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
