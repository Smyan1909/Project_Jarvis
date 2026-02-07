// =============================================================================
// Tool Router Types
// =============================================================================

/**
 * Result returned by tool execution
 */
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: Record<string, unknown> };

/**
 * Tool handler function signature
 */
export type ToolHandler<T = unknown> = (args: T) => Promise<ToolResult>;

/**
 * Registered tool definition
 */
export interface RegisteredTool {
  /** Unique tool ID (e.g., "browser.navigate") */
  id: string;
  /** Tool category for organization (e.g., "browser", "code") */
  category: string;
  /** Human-readable tool name */
  name: string;
  /** Brief description of what the tool does */
  description: string;
  /** Full JSON schema for tool input */
  inputSchema: Record<string, unknown>;
  /** Keywords for suggestion matching */
  keywords: string[];
  /** Handler function to execute the tool */
  handler: ToolHandler;
}

/**
 * Tool summary for list_available_tools response
 */
export interface ToolSummary {
  id: string;
  category: string;
  name: string;
  description: string;
}

/**
 * Category with its tools
 */
export interface ToolCategory {
  category: string;
  tools: ToolSummary[];
}

/**
 * Response from list_available_tools
 */
export interface ListToolsResponse {
  categories: Record<string, ToolSummary[]>;
  totalTools: number;
}

/**
 * Response from get_tool_schema
 */
export interface GetToolSchemaResponse {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Response from suggest_tools
 */
export interface SuggestToolsResponse {
  suggestions: ToolSuggestion[];
  tip: string;
}

export interface ToolSuggestion {
  id: string;
  name: string;
  description: string;
  relevanceScore: number;
  category: string;
}

/**
 * Tool registration options
 */
export interface ToolRegistrationOptions {
  /** Override the auto-generated category from ID */
  category?: string;
  /** Additional keywords for suggestion matching */
  additionalKeywords?: string[];
}
