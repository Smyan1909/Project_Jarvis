// =============================================================================
// Tool Router
// =============================================================================
// Central registry for all tools with dynamic discovery and execution

import type {
  RegisteredTool,
  ToolHandler,
  ToolResult,
  ToolSummary,
  ListToolsResponse,
  GetToolSchemaResponse,
  SuggestToolsResponse,
  ToolSuggestion,
  ToolRegistrationOptions,
} from './types.js';

/**
 * Tool Router - Central registry for dynamic tool management
 *
 * Instead of exposing all tools directly to the LLM (which bloats context),
 * tools are registered here and accessed through meta-tools:
 * - list_available_tools: Discover what tools exist
 * - get_tool_schema: Get full schema for a specific tool
 * - execute_tool: Run a tool by ID
 * - suggest_tools: Get AI-friendly suggestions based on task description
 */
export class ToolRouter {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool with the router
   */
  register(
    id: string,
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler,
    options: ToolRegistrationOptions = {}
  ): void {
    // Extract category from ID (e.g., "browser.navigate" -> "browser")
    const category = options.category ?? id.split('.')[0];

    // Generate keywords from name, description, and ID
    const keywords = this.generateKeywords(id, name, description, options.additionalKeywords);

    const tool: RegisteredTool = {
      id,
      category,
      name,
      description,
      inputSchema,
      keywords,
      handler,
    };

    this.tools.set(id, tool);
  }

  /**
   * Register a tool using a tool definition object
   */
  registerTool(tool: Omit<RegisteredTool, 'keywords'> & { keywords?: string[] }): void {
    const keywords = tool.keywords ?? this.generateKeywords(tool.id, tool.name, tool.description);

    this.tools.set(tool.id, {
      ...tool,
      keywords,
    });
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  /**
   * Check if a tool exists
   */
  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * List all tools organized by category
   */
  listTools(categoryFilter?: string): ListToolsResponse {
    const categories: Record<string, ToolSummary[]> = {};

    for (const tool of this.tools.values()) {
      if (categoryFilter && tool.category !== categoryFilter) {
        continue;
      }

      if (!categories[tool.category]) {
        categories[tool.category] = [];
      }

      categories[tool.category].push({
        id: tool.id,
        category: tool.category,
        name: tool.name,
        description: tool.description,
      });
    }

    // Sort tools within each category by ID
    for (const category of Object.keys(categories)) {
      categories[category].sort((a, b) => a.id.localeCompare(b.id));
    }

    return {
      categories,
      totalTools: this.tools.size,
    };
  }

  /**
   * Get full schema for a tool
   */
  getToolSchema(toolId: string): GetToolSchemaResponse | null {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return null;
    }

    return {
      toolId: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }

  /**
   * Execute a tool by ID
   */
  async executeTool(toolId: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${toolId}". Use list_available_tools to see available tools.` }],
        isError: true,
      };
    }

    try {
      return await tool.handler(args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error executing tool "${toolId}": ${errorMessage}` }],
        isError: true,
      };
    }
  }

  /**
   * Suggest tools based on a natural language task description
   */
  suggestTools(task: string, maxSuggestions: number = 5): SuggestToolsResponse {
    const taskLower = task.toLowerCase();
    const taskWords = this.tokenize(taskLower);

    const suggestions: ToolSuggestion[] = [];

    for (const tool of this.tools.values()) {
      const score = this.calculateRelevanceScore(taskWords, taskLower, tool);
      if (score > 0) {
        suggestions.push({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          relevanceScore: score,
          category: tool.category,
        });
      }
    }

    // Sort by relevance score descending
    suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Take top N suggestions
    const topSuggestions = suggestions.slice(0, maxSuggestions);

    return {
      suggestions: topSuggestions,
      tip: topSuggestions.length > 0
        ? `Found ${topSuggestions.length} relevant tool(s). Use get_tool_schema to see the full input parameters before calling execute_tool.`
        : 'No matching tools found. Try using list_available_tools to browse all available tools by category.',
    };
  }

  /**
   * Get all registered tool IDs
   */
  getToolIds(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get count of registered tools
   */
  getToolCount(): number {
    return this.tools.size;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate keywords from tool metadata
   */
  private generateKeywords(
    id: string,
    name: string,
    description: string,
    additional?: string[]
  ): string[] {
    const words = new Set<string>();

    // Add words from ID (split by dots)
    id.split('.').forEach(part => words.add(part.toLowerCase()));

    // Add words from name
    this.tokenize(name.toLowerCase()).forEach(word => words.add(word));

    // Add words from description
    this.tokenize(description.toLowerCase()).forEach(word => {
      if (word.length > 2) { // Skip very short words
        words.add(word);
      }
    });

    // Add additional keywords
    additional?.forEach(kw => words.add(kw.toLowerCase()));

    return Array.from(words);
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Calculate relevance score for a tool given a task description
   */
  private calculateRelevanceScore(
    taskWords: string[],
    taskLower: string,
    tool: RegisteredTool
  ): number {
    let score = 0;

    // Check for keyword matches
    for (const keyword of tool.keywords) {
      if (taskLower.includes(keyword)) {
        // Exact substring match in task
        score += 3;
      }

      for (const taskWord of taskWords) {
        if (taskWord === keyword) {
          // Exact word match
          score += 5;
        } else if (taskWord.includes(keyword) || keyword.includes(taskWord)) {
          // Partial match
          score += 2;
        }
      }
    }

    // Boost for category match
    if (taskLower.includes(tool.category)) {
      score += 4;
    }

    // Boost for specific action words matching tool name
    const actionWords = ['click', 'type', 'navigate', 'go', 'open', 'fill', 'submit', 'login', 'search', 'scroll', 'wait', 'screenshot', 'capture', 'upload', 'download', 'select', 'hover', 'drag', 'code', 'run', 'execute'];
    for (const action of actionWords) {
      if (taskLower.includes(action) && tool.keywords.includes(action)) {
        score += 6;
      }
    }

    // Boost for URL/website mentions with browser tools
    if ((taskLower.includes('url') || taskLower.includes('website') || taskLower.includes('page') || taskLower.includes('web')) && tool.category === 'browser') {
      score += 2;
    }

    // Boost for code/file mentions with claude_code
    if ((taskLower.includes('code') || taskLower.includes('file') || taskLower.includes('git') || taskLower.includes('edit')) && tool.id === 'claude_code') {
      score += 4;
    }

    return score;
  }
}

// Export singleton instance
export const toolRouter = new ToolRouter();

// Re-export types
export * from './types.js';
