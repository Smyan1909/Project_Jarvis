// =============================================================================
// Tool Conversion Utilities
// =============================================================================
// Convert between @project-jarvis/shared-types ToolDefinition and Vercel AI SDK tools

import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import type {
  ToolDefinition,
  ToolParameter,
  ToolParameters,
} from '@project-jarvis/shared-types';

/**
 * Convert our ToolDefinition[] to Vercel AI SDK ToolSet
 *
 * Note: execute functions are omitted here - they should be handled
 * separately via ToolInvokerPort for proper permission checking
 * and audit logging.
 *
 * @param tools - Array of tool definitions from shared-types
 * @returns Record of AI SDK tools keyed by tool name
 */
export function convertToolDefinitions(
  tools: ToolDefinition[]
): Record<string, CoreTool> {
  const toolSet: Record<string, CoreTool> = {};

  for (const t of tools) {
    toolSet[t.name] = tool({
      description: t.description,
      parameters: convertParametersToZod(t.parameters),
      // execute is intentionally omitted - handled by ToolInvokerPort
    });
  }

  return toolSet;
}

/**
 * Convert JSON Schema-like ToolParameters to Zod schema
 *
 * @param params - Tool parameters in JSON Schema format
 * @returns Zod object schema
 */
function convertParametersToZod(params: ToolParameters): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  const requiredFields = new Set(params.required ?? []);

  for (const [key, param] of Object.entries(params.properties)) {
    let fieldSchema = convertParameterToZod(param);

    // Make optional if not in required array
    if (!requiredFields.has(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Convert a single ToolParameter to its Zod equivalent
 *
 * @param param - Single parameter definition
 * @returns Corresponding Zod type
 */
function convertParameterToZod(param: ToolParameter): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (param.type) {
    case 'string':
      if (param.enum && param.enum.length > 0) {
        // Handle enum as literal union
        schema = z.enum(param.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;

    case 'number':
      schema = z.number();
      break;

    case 'boolean':
      schema = z.boolean();
      break;

    case 'array':
      if (param.items) {
        schema = z.array(convertParameterToZod(param.items));
      } else {
        schema = z.array(z.unknown());
      }
      break;

    case 'object':
      // For nested objects without full schema, use record
      schema = z.record(z.string(), z.unknown());
      break;

    default:
      schema = z.unknown();
  }

  // Add description if present
  if (param.description) {
    schema = schema.describe(param.description);
  }

  return schema;
}

/**
 * Create a tool with an execute function for direct use
 *
 * Use this when you want to create a tool that executes inline
 * rather than going through ToolInvokerPort.
 *
 * @param definition - Tool definition from shared-types
 * @param execute - Async function to execute the tool
 * @returns AI SDK tool with execute function
 */
export function createExecutableTool<TInput, TOutput>(
  definition: ToolDefinition,
  execute: (input: TInput) => Promise<TOutput>
): CoreTool {
  return tool({
    description: definition.description,
    parameters: convertParametersToZod(definition.parameters),
    execute: execute as (input: unknown) => Promise<unknown>,
  });
}
