// =============================================================================
// Tool Registry Service
// =============================================================================
// Central registry for all tools available to agents
// Implements ToolInvokerPort with registration, permission checking, and invocation

import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort.js';
import type { ToolPermissionRepository } from '../../adapters/storage/tool-permission-repository.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * Handler function signature for tool execution
 */
export type ToolHandler = (userId: string, input: Record<string, unknown>) => Promise<unknown>;

/**
 * Internal representation of a registered tool
 */
interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  /**
   * Optional: List of agent types that can use this tool
   * If undefined, all agents can use it
   */
  allowedAgents?: string[];
  /**
   * Optional: Tool category for organization
   */
  category?: 'builtin' | 'memory' | 'kg' | 'web' | 'orchestrator' | 'custom';
}

/**
 * Tool Registry - Central hub for tool management
 *
 * Features:
 * - Register tools with definitions and handlers
 * - Permission checking (user-level and agent-level)
 * - Safe tool invocation with error handling
 * - Built-in tools for common operations
 *
 * Usage:
 * ```typescript
 * const registry = new ToolRegistry();
 * registerBuiltInTools(registry);
 * registerMemoryTools(registry, memoryStore);
 *
 * // Get tools for an agent
 * const tools = await registry.getTools(userId);
 *
 * // Invoke a tool
 * const result = await registry.invoke(userId, 'get_current_time', { timezone: 'UTC' });
 * ```
 */
export class ToolRegistry implements ToolInvokerPort {
  private tools: Map<string, RegisteredTool> = new Map();
  private log = logger.child({ service: 'ToolRegistry' });
  private permissionRepository?: ToolPermissionRepository;

  /**
   * Set the permission repository for user-level access control
   * When set, hasPermission() will check the database for explicit denials
   */
  setPermissionRepository(repo: ToolPermissionRepository): void {
    this.permissionRepository = repo;
    this.log.info('Permission repository configured');
  }

  /**
   * Register a new tool
   *
   * @param definition - Tool definition with id, name, description, parameters
   * @param handler - Async function to execute when tool is invoked
   * @param options - Optional configuration for allowed agents and category
   */
  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    options?: { allowedAgents?: string[]; category?: RegisteredTool['category'] }
  ): void {
    this.tools.set(definition.id, {
      definition,
      handler,
      allowedAgents: options?.allowedAgents,
      category: options?.category,
    });
    this.log.info('Tool registered', {
      toolId: definition.id,
      name: definition.name,
      category: options?.category || 'custom',
    });
  }

  /**
   * Unregister a tool
   */
  unregister(toolId: string): void {
    if (this.tools.delete(toolId)) {
      this.log.info('Tool unregistered', { toolId });
    }
  }

  /**
   * Get all available tools for a user
   *
   * @param userId - User requesting tools
   * @param agentType - Optional: Filter tools by agent type (e.g., 'orchestrator', 'general')
   */
  async getTools(userId: string, agentType?: string): Promise<ToolDefinition[]> {
    const candidateTools: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      // If agent type is specified and tool has restrictions, check if allowed
      if (agentType && tool.allowedAgents && !tool.allowedAgents.includes(agentType)) {
        continue;
      }

      candidateTools.push(tool.definition);
    }

    // If permission repository is configured, filter by user permissions
    if (this.permissionRepository && candidateTools.length > 0) {
      const toolIds = candidateTools.map((t) => t.id);
      const permissions = await this.permissionRepository.hasPermissions(userId, toolIds);

      const availableTools = candidateTools.filter((tool) => {
        const permitted = permissions.get(tool.id);
        return permitted !== false; // Allow if true or undefined (default)
      });

      this.log.debug('Tools retrieved with permission filtering', {
        userId,
        agentType: agentType || 'all',
        candidateCount: candidateTools.length,
        availableCount: availableTools.length,
      });

      return availableTools;
    }

    this.log.debug('Tools retrieved', {
      userId,
      agentType: agentType || 'all',
      count: candidateTools.length,
    });

    return candidateTools;
  }

  /**
   * Get tools filtered for a specific agent type
   * This excludes orchestrator-only tools from sub-agents
   */
  async getToolsForAgent(userId: string, agentType: string): Promise<ToolDefinition[]> {
    return this.getTools(userId, agentType);
  }

  /**
   * Invoke a tool with the given input
   */
  async invoke(
    userId: string,
    toolId: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const log = this.log.child({ userId, toolId });
    const tool = this.tools.get(toolId);

    if (!tool) {
      log.warn('Tool not found');
      return {
        success: false,
        output: null,
        error: `Tool '${toolId}' not found`,
      };
    }

    const startTime = Date.now();

    try {
      log.debug('Invoking tool', { input });
      const output = await tool.handler(userId, input);
      const durationMs = Date.now() - startTime;

      log.info('Tool invocation successful', { durationMs });
      return { success: true, output };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('Tool invocation failed', error, { durationMs });
      return {
        success: false,
        output: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a user has permission to use a specific tool
   *
   * Permission model:
   * 1. Tool must be registered in the registry
   * 2. If permission repository is configured, check for explicit denials
   * 3. Default: all registered tools are available
   */
  async hasPermission(userId: string, toolId: string): Promise<boolean> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return false;
    }

    // If permission repository is configured, check database
    if (this.permissionRepository) {
      const permitted = await this.permissionRepository.hasPermission(userId, toolId);
      if (!permitted) {
        this.log.debug('Tool access denied by permission check', { userId, toolId });
        return false;
      }
    }

    return true;
  }

  /**
   * Get a list of all registered tool IDs
   */
  getRegisteredToolIds(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool is registered
   */
  isRegistered(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: RegisteredTool['category']): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.category === category)
      .map((tool) => tool.definition);
  }
}

// =============================================================================
// Built-in Tools Registration
// =============================================================================

/**
 * Register built-in tools that don't require external dependencies
 */
export function registerBuiltInTools(registry: ToolRegistry): void {
  // -------------------------------------------------------------------------
  // get_current_time - Get current date/time in any timezone
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'get_current_time',
      name: 'get_current_time',
      description:
        'Get the current date and time. Optionally specify a timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo", "UTC").',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description:
              'IANA timezone name (e.g., "America/New_York", "UTC"). Defaults to UTC if not specified.',
          },
        },
      },
    },
    async (_userId, input) => {
      const timezone = (input.timezone as string) || 'UTC';

      try {
        const now = new Date();
        const formatted = now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        });

        return {
          datetime: formatted,
          timezone,
          iso: now.toISOString(),
          timestamp: now.getTime(),
        };
      } catch {
        // Invalid timezone
        return {
          error: `Invalid timezone: ${timezone}`,
          validExamples: ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC'],
        };
      }
    },
    { category: 'builtin' }
  );

  // -------------------------------------------------------------------------
  // calculate - Safe mathematical expression evaluation
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'calculate',
      name: 'calculate',
      description:
        'Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, ^), parentheses, and common functions (sqrt, sin, cos, tan, log, abs, floor, ceil, round, min, max, pow, PI, E).',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description:
              'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(PI/2)", "pow(2, 10)")',
          },
        },
        required: ['expression'],
      },
    },
    async (_userId, input) => {
      const expression = input.expression as string;

      if (!expression || typeof expression !== 'string') {
        return { error: 'Expression is required' };
      }

      try {
        // Sanitize and evaluate expression safely
        const result = safeEvaluate(expression);
        return {
          expression,
          result,
          formatted: typeof result === 'number' ? formatNumber(result) : String(result),
        };
      } catch (error) {
        return {
          expression,
          error: error instanceof Error ? error.message : 'Invalid expression',
        };
      }
    },
    { category: 'builtin' }
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Safely evaluate a mathematical expression
 * Only allows numbers, operators, and Math functions
 */
function safeEvaluate(expression: string): number {
  // Whitelist of allowed tokens
  const allowedPattern =
    /^[\d\s+\-*/().^,]+$|^[\d\s+\-*/().^,]*(sqrt|sin|cos|tan|log|log10|log2|abs|floor|ceil|round|min|max|pow|exp|PI|E)[\d\s+\-*/().^,]*$/gi;

  // Replace common math constants and functions
  let sanitized = expression
    .replace(/\^/g, '**') // Power operator
    .replace(/PI/gi, 'Math.PI')
    .replace(/\bE\b/gi, 'Math.E')
    .replace(/sqrt/gi, 'Math.sqrt')
    .replace(/sin/gi, 'Math.sin')
    .replace(/cos/gi, 'Math.cos')
    .replace(/tan/gi, 'Math.tan')
    .replace(/log10/gi, 'Math.log10')
    .replace(/log2/gi, 'Math.log2')
    .replace(/\blog\b/gi, 'Math.log')
    .replace(/abs/gi, 'Math.abs')
    .replace(/floor/gi, 'Math.floor')
    .replace(/ceil/gi, 'Math.ceil')
    .replace(/round/gi, 'Math.round')
    .replace(/min/gi, 'Math.min')
    .replace(/max/gi, 'Math.max')
    .replace(/pow/gi, 'Math.pow')
    .replace(/exp/gi, 'Math.exp');

  // Additional safety check - only allow specific characters after substitution
  const safePattern = /^[\d\s+\-*/().Math,]+$/;
  if (!safePattern.test(sanitized)) {
    throw new Error('Expression contains invalid characters');
  }

  // Evaluate using Function constructor (safer than eval, but still isolated)
  const fn = new Function(`"use strict"; return (${sanitized})`);
  const result = fn();

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Result is not a valid number');
  }

  return result;
}

/**
 * Format a number for display
 */
function formatNumber(num: number): string {
  if (Number.isInteger(num)) {
    return num.toString();
  }
  // Round to reasonable precision
  return parseFloat(num.toPrecision(10)).toString();
}
