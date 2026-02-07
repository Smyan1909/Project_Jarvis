// =============================================================================
// Meta-Tools
// =============================================================================
// The 5 tools that are actually exposed to the LLM via MCP protocol

import { z } from 'zod';
import { toolRouter, type ToolResult } from './index.js';

// =============================================================================
// Tool Schemas (for MCP registration)
// =============================================================================

/**
 * Schema for list_available_tools
 */
export const listAvailableToolsSchema = {
  name: 'list_available_tools',
  description: `List all available tools organized by category. Returns tool IDs, names, and brief descriptions.

IMPORTANT: Start here to discover what tools are available. This server provides dynamic access to 20+ browser automation and code execution tools without bloating your context.

Workflow:
1. Call this tool to see available tools
2. Use suggest_tools if you have a specific task in mind
3. Use get_tool_schema to get full parameters for a tool
4. Use execute_tool to run the tool`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Optional: filter by category (e.g., "browser", "browser.tabs")',
      },
    },
  },
};

/**
 * Schema for get_tool_schema
 */
export const getToolSchemaSchema = {
  name: 'get_tool_schema',
  description: `Get the full input schema for a specific tool by its ID.

Use this BEFORE calling execute_tool to understand all required and optional parameters. Returns the complete JSON schema including parameter types, descriptions, and validation rules.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      toolId: {
        type: 'string',
        description: 'The tool ID from list_available_tools (e.g., "browser.navigate", "browser.click")',
      },
    },
    required: ['toolId'],
  },
};

/**
 * Schema for execute_tool
 */
export const executeToolSchema = {
  name: 'execute_tool',
  description: `Execute a registered tool by its ID with the provided arguments.

IMPORTANT: Always call get_tool_schema first to understand the required parameters for the tool you want to execute.

The argsJson parameter must be a valid JSON string containing the tool's arguments.

Example:
1. get_tool_schema({ toolId: "browser.navigate" }) -> see that "url" is required
2. execute_tool({ toolId: "browser.navigate", argsJson: "{\\"url\\": \\"https://example.com\\"}" })

For tools with no required arguments, pass an empty object: argsJson: "{}"`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      toolId: {
        type: 'string',
        description: 'The tool ID to execute (e.g., "browser.navigate")',
      },
      argsJson: {
        type: 'string',
        description: 'JSON string containing arguments for the tool. Example: "{\\"url\\": \\"https://example.com\\"}"',
      },
    },
    required: ['toolId', 'argsJson'],
  },
};

/**
 * Schema for suggest_tools
 */
export const suggestToolsSchema = {
  name: 'suggest_tools',
  description: `Get tool suggestions based on what you want to accomplish. Describe your task in natural language and receive relevant tool recommendations.

RECOMMENDED: Use this as your first step when you have a specific task. It's more efficient than browsing all tools manually.

Examples:
- "I need to log into a website" -> suggests browser.navigate, browser.fill_form, browser.click
- "take a screenshot of the current page" -> suggests browser.screenshot
- "fill out a contact form" -> suggests browser.fill_form, browser.type
- "write some code to parse JSON" -> suggests claude_code`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description: 'Natural language description of what you want to accomplish',
      },
      maxSuggestions: {
        type: 'number',
        description: 'Maximum number of suggestions to return (default: 5)',
      },
    },
    required: ['task'],
  },
};

/**
 * Schema for claude_code (direct access, not routed)
 */
export const claudeCodeSchema = {
  name: 'claude_code',
  description: `Execute complex coding tasks using Claude CLI as a powerful sub-agent. This tool has full system access with permissions bypassed.

Use this for:
- Code generation and refactoring
- File operations (create, edit, move, delete)
- Git operations (commit, push, branch, merge)
- Running terminal commands
- Complex multi-step workflows
- Any task that benefits from Claude's coding capabilities

The sub-agent can see your file system and execute commands, making it ideal for substantial coding tasks.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'The task/prompt to execute. Be specific about what you want to accomplish.',
      },
      workFolder: {
        type: 'string',
        description: 'Working directory for file operations (absolute path). Defaults to current directory.',
      },
    },
    required: ['prompt'],
  },
};

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handler for list_available_tools
 */
export async function handleListAvailableTools(args: unknown): Promise<ToolResult> {
  const parsed = z.object({
    category: z.string().optional(),
  }).safeParse(args);

  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const result = toolRouter.listTools(parsed.data.category);

  // Format as readable text
  let output = `# Available Tools (${result.totalTools} total)\n\n`;

  const sortedCategories = Object.keys(result.categories).sort();
  for (const category of sortedCategories) {
    const tools = result.categories[category];
    output += `## ${category}\n`;
    for (const tool of tools) {
      output += `- **${tool.id}**: ${tool.description}\n`;
    }
    output += '\n';
  }

  output += `---\nTip: Use suggest_tools("your task") to find relevant tools, or get_tool_schema("tool.id") to see full parameters.`;

  return {
    content: [{ type: 'text', text: output }],
  };
}

/**
 * Handler for get_tool_schema
 */
export async function handleGetToolSchema(args: unknown): Promise<ToolResult> {
  const parsed = z.object({
    toolId: z.string(),
  }).safeParse(args);

  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const schema = toolRouter.getToolSchema(parsed.data.toolId);

  if (!schema) {
    return {
      content: [{ type: 'text', text: `Tool "${parsed.data.toolId}" not found. Use list_available_tools to see available tools.` }],
      isError: true,
    };
  }

  // Format as readable JSON with context
  // Generate example argsJson based on schema
  const exampleArgs: Record<string, unknown> = {};
  const schemaProps = (schema.inputSchema?.properties || {}) as Record<string, { type?: string; description?: string }>;
  const requiredFields = (schema.inputSchema?.required as string[]) || [];
  
  for (const field of requiredFields) {
    const prop = schemaProps[field];
    if (prop?.type === 'string') {
      exampleArgs[field] = `<${field}>`;
    } else if (prop?.type === 'number') {
      exampleArgs[field] = 0;
    } else if (prop?.type === 'boolean') {
      exampleArgs[field] = true;
    }
  }
  
  const exampleArgsJson = JSON.stringify(exampleArgs).replace(/"/g, '\\"');

  const output = `# Tool: ${schema.name}

**ID:** ${schema.toolId}
**Description:** ${schema.description}

## Input Schema

\`\`\`json
${JSON.stringify(schema.inputSchema, null, 2)}
\`\`\`

---
Ready to use: execute_tool({ toolId: "${schema.toolId}", argsJson: "${exampleArgsJson}" })`;

  return {
    content: [{ type: 'text', text: output }],
  };
}

/**
 * Handler for execute_tool
 */
export async function handleExecuteTool(args: unknown): Promise<ToolResult> {
  const parsed = z.object({
    toolId: z.string(),
    argsJson: z.string().default('{}'),
  }).safeParse(args);

  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  // Parse the JSON string to get the actual arguments
  let toolArgs: Record<string, unknown>;
  try {
    toolArgs = JSON.parse(parsed.data.argsJson);
    if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) {
      throw new Error('argsJson must be a JSON object');
    }
  } catch (e) {
    return {
      content: [{ 
        type: 'text', 
        text: `Invalid argsJson: ${e instanceof Error ? e.message : 'Failed to parse JSON'}. Expected a JSON object string like "{\\"key\\": \\"value\\"}"` 
      }],
      isError: true,
    };
  }

  return toolRouter.executeTool(parsed.data.toolId, toolArgs);
}

/**
 * Handler for suggest_tools
 */
export async function handleSuggestTools(args: unknown): Promise<ToolResult> {
  const parsed = z.object({
    task: z.string(),
    maxSuggestions: z.number().optional().default(5),
  }).safeParse(args);

  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const result = toolRouter.suggestTools(parsed.data.task, parsed.data.maxSuggestions);

  // Format as readable text
  let output = `# Tool Suggestions for: "${parsed.data.task}"\n\n`;

  if (result.suggestions.length === 0) {
    output += 'No matching tools found.\n\n';
    output += 'Try:\n';
    output += '- Using different keywords\n';
    output += '- Calling list_available_tools to browse all tools\n';
  } else {
    output += `Found ${result.suggestions.length} relevant tool(s):\n\n`;
    
    for (const suggestion of result.suggestions) {
      const stars = '★'.repeat(Math.min(5, Math.ceil(suggestion.relevanceScore / 5)));
      output += `### ${suggestion.id} ${stars}\n`;
      output += `**${suggestion.name}** (${suggestion.category})\n`;
      output += `${suggestion.description}\n\n`;
    }
  }

  output += `---\n${result.tip}`;

  return {
    content: [{ type: 'text', text: output }],
  };
}

// =============================================================================
// Export all meta-tool definitions
// =============================================================================

export const metaToolSchemas = [
  listAvailableToolsSchema,
  getToolSchemaSchema,
  executeToolSchema,
  suggestToolsSchema,
  claudeCodeSchema,
];

export const metaToolHandlers: Record<string, (args: unknown) => Promise<ToolResult>> = {
  list_available_tools: handleListAvailableTools,
  get_tool_schema: handleGetToolSchema,
  execute_tool: handleExecuteTool,
  suggest_tools: handleSuggestTools,
  // claude_code handler is registered separately as it's a first-class tool
};
