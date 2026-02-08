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
 * Uses strict() mode to set additionalProperties: false in JSON Schema,
 * which is required by OpenAI's function calling API.
 *
 * Note: OpenAI strict mode requires ALL properties to be in the required array.
 * Optional fields are handled by allowing the model to pass empty/null values.
 *
 * @param params - Tool parameters in JSON Schema format
 * @returns Zod object schema
 */
function convertParametersToZod(params: ToolParameters): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  const requiredFields = new Set(params.required ?? []);

  for (const [key, param] of Object.entries(params.properties)) {
    let fieldSchema = convertParameterToZod(param);

    // For OpenAI strict mode, all fields must be in 'required', but we can make them nullable
    // to indicate they're optional semantically
    if (!requiredFields.has(key)) {
      fieldSchema = fieldSchema.nullable();
    }

    shape[key] = fieldSchema;
  }

  // Use strict() to set additionalProperties: false - required by OpenAI
  return z.object(shape).strict();
}

/**
 * Convert a single ToolParameter to its Zod equivalent
 *
 * OpenAI's strict mode requires ALL properties to be in the required array.
 * We handle this by making all nested object fields required in the Zod schema.
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
        schema = z.array(z.string()); // Default to string array instead of unknown
      }
      break;

    case 'object': {
      const hasProps = param.properties && Object.keys(param.properties).length > 0;
      const hasAdditionalProps = param.additionalProperties === true;
      
      // Handle nested objects with defined properties
      if (hasProps) {
        const shape: z.ZodRawShape = {};
        
        // OpenAI strict mode requires ALL properties to be required
        // So we make all fields required in the Zod schema
        for (const [key, nestedParam] of Object.entries(param.properties!)) {
          shape[key] = convertParameterToZod(nestedParam);
        }

        // OpenAI strict mode does NOT support additionalProperties: true
        // If the source schema has additionalProperties: true but also has defined properties,
        // we ignore the additionalProperties and use strict() to satisfy OpenAI
        schema = z.object(shape).strict();
      } else if (hasAdditionalProps) {
        // For objects with no defined properties but additionalProperties: true (dynamic objects)
        // OpenAI does NOT support additionalProperties: true in strict mode
        // Convert to a JSON string that the model will populate with a JSON object
        // The caller will need to JSON.parse() this string
        const jsonInstruction = '(Provide as a JSON string, e.g. {"key": "value"})';
        schema = z.string().describe(
          (param.description ? param.description + ' ' : '') + jsonInstruction
        );
        // Return early to avoid overwriting the description with just param.description
        return schema;
      } else {
        // For objects without defined properties and additionalProperties is false or undefined
        // OpenAI requires additionalProperties: false, so use strict() on an empty object
        // This generates { "type": "object", "properties": {}, "additionalProperties": false }
        schema = z.object({}).strict();
      }
      break;
    }

    default:
      schema = z.string(); // Default to string instead of unknown
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
