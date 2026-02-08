// =============================================================================
// Agent Tool Scopes
// =============================================================================
// Defines which tools each specialized agent type has access to.
// Sub-agents are scoped to their specialization to:
// 1. Keep them focused on their assigned task
// 2. Prevent privilege escalation
// 3. Reduce cognitive load on the agent

import type { AgentType } from '@project-jarvis/shared-types';
import { ORCHESTRATOR_ONLY_TOOL_IDS } from './OrchestratorTools.js';

// =============================================================================
// Tool Scopes per Agent Type
// =============================================================================

/**
 * Maps each agent type to the tool IDs it has access to.
 * 
 * NOTE: These are base tool sets. The orchestrator can grant additional
 * tools to specific agents via the `additionalTools` parameter when spawning.
 */
export const AGENT_TOOL_SCOPES: Record<AgentType, string[]> = {
  // General agent - broad access for versatile tasks
  general: [
    // Memory (read-only)
    'recall',
    'kg_query',
    // Utilities
    'get_current_time',
    'calculate',
    // Basic web access
    'web_search',
  ],

  // Research agent - information gathering and analysis
  research: [
    // Memory (read-only)
    'recall',
    'kg_query',
    // Web research
    'web_search',
    'web_fetch',
    'web_scrape',
    // Analysis
    'summarize',
    'extract_entities',
    'compare_sources',
  ],

  // Coding agent - programming and file operations
  // This agent has extensive tool access for end-to-end software development
  coding: [
    // Memory (read-only)
    'recall',
    
    // === MCP Tools - Claude Code (Primary) ===
    // The most powerful tool - spawns Claude CLI with full system access
    'unified__claude_code',
    
    // === MCP Tools - Terminal ===
    // Direct shell command execution for builds, tests, etc.
    'unified__terminal_execute',
    'unified__terminal_cwd',
    
    // === MCP Tools - Filesystem ===
    // Direct file operations (alternative to Claude Code for simple reads)
    'unified__fs_read',
    'unified__fs_write',
    'unified__fs_delete',
    'unified__fs_list',
    'unified__fs_mkdir',
    
    // === MCP Tools - Browser Automation (Playwright) ===
    // Navigation
    'unified__browser.navigate',
    'unified__browser.back',
    'unified__browser.forward',
    'unified__browser.reload',
    'unified__browser.close',
    // Interaction
    'unified__browser.click',
    'unified__browser.type',
    'unified__browser.hover',
    'unified__browser.select',
    'unified__browser.key',
    'unified__browser.drag',
    'unified__browser.upload',
    'unified__browser.fill_form',
    'unified__browser.scroll',
    // Inspection
    'unified__browser.snapshot',
    'unified__browser.screenshot',
    'unified__browser.console',
    'unified__browser.network',
    'unified__browser.evaluate',
    'unified__browser.html',
    'unified__browser.url',
    
    // === MCP Meta Tools ===
    // For discovering and executing additional tools
    'unified__list_available_tools',
    'unified__get_tool_schema',
    'unified__execute_tool',
    'unified__suggest_tools',
    
    // === Composio MCP Tools ===
    // Meta-tools for dynamic tool discovery and execution via Composio Tool Router
    // These require MCP_SERVER_<N>_NAME=composio in environment variables
    'composio__COMPOSIO_SEARCH_TOOLS',        // Search for available tools/integrations
    'composio__COMPOSIO_MANAGE_CONNECTIONS',  // Initiate OAuth connections for apps
    'composio__COMPOSIO_MULTI_EXECUTE_TOOL',  // Execute discovered tools
    'composio__COMPOSIO_REMOTE_WORKBENCH',    // Remote workbench for complex tasks
    'composio__COMPOSIO_REMOTE_BASH_TOOL',    // Remote bash execution
    
    // === Legacy Local Tools (for backwards compatibility) ===
    // File operations
    'file_read',
    'file_write',
    'file_list',
    'file_delete',
    // Code operations
    'code_execute',
    'code_analyze',
    'code_format',
    'code_lint',
    // Git operations
    'git_status',
    'git_diff',
    'git_commit',
  ],

  // Scheduling agent - calendar and time management
  scheduling: [
    // Memory (read-only)
    'recall',
    // Time utilities
    'get_current_time',
    'calculate',
    // Calendar operations
    'calendar_list',
    'calendar_get',
    'calendar_create',
    'calendar_update',
    'calendar_delete',
    // Reminder operations
    'reminder_list',
    'reminder_create',
    'reminder_update',
    'reminder_delete',
  ],

  // Productivity agent - tasks, notes, and documents
  productivity: [
    // Memory (read-only)
    'recall',
    // Time utilities
    'get_current_time',
    // Task management
    'task_list',
    'task_get',
    'task_create',
    'task_update',
    'task_delete',
    'task_complete',
    // Note operations
    'note_list',
    'note_get',
    'note_create',
    'note_update',
    'note_delete',
    'note_search',
    // Document operations
    'document_create',
    'document_update',
  ],

  // Messaging agent - communication
  messaging: [
    // Memory (read-only)
    'recall',
    // Email operations
    'email_list',
    'email_get',
    'email_send',
    'email_draft',
    'email_reply',
    // SMS operations
    'sms_send',
    // Notification operations
    'notification_send',
    // Contact operations
    'contact_search',
    'contact_get',
  ],
};

// =============================================================================
// Agent Capabilities (Human-readable descriptions)
// =============================================================================

/**
 * Human-readable descriptions of what each agent type can do.
 * Used in system prompts to help agents understand their role.
 */
export const AGENT_CAPABILITIES: Record<AgentType, string> = {
  general: `You are a general-purpose assistant capable of:
- Searching and recalling information from memory
- Performing calculations
- Getting current time
- Basic web searches
Use this versatility to handle tasks that don't fit other specialized agents.`,

  research: `You are a research specialist capable of:
- Searching the web for information
- Fetching and analyzing web pages
- Summarizing content
- Extracting entities and facts
- Comparing multiple sources
Focus on gathering accurate, comprehensive information.`,

  coding: `You are an autonomous end-to-end coding agent capable of:
- Full file system access via Claude Code (create, edit, delete files)
- Terminal command execution (builds, tests, package management)
- Git operations (commit, branch, merge, push with confirmation)
- Browser automation via Playwright (navigation, interaction, inspection)
- Composio Tool Router integration for 100+ external services (GitHub, Slack, Jira, etc.)
  - Use COMPOSIO_SEARCH_TOOLS to discover available integrations
  - Use COMPOSIO_MANAGE_CONNECTIONS to set up OAuth for apps
  - Use COMPOSIO_MULTI_EXECUTE_TOOL to execute discovered tools
- Complex multi-file refactoring and code generation
You operate with high autonomy - complete tasks independently and verify with tests.`,

  scheduling: `You are a scheduling specialist capable of:
- Managing calendar events
- Creating and updating appointments
- Setting reminders
- Time calculations
Focus on efficient time management and avoiding conflicts.`,

  productivity: `You are a productivity specialist capable of:
- Managing tasks and todo lists
- Creating and organizing notes
- Working with documents
- Tracking task completion
Focus on helping the user stay organized and productive.`,

  messaging: `You are a messaging specialist capable of:
- Sending and drafting emails
- Sending SMS messages
- Managing notifications
- Looking up contacts
Focus on clear, professional communication.`,
};

// =============================================================================
// Tool Access Helpers
// =============================================================================

/**
 * Get the full list of tools available to an agent type,
 * including any additional tools granted by the orchestrator.
 */
export function getAgentTools(
  agentType: AgentType,
  additionalTools: string[] = []
): string[] {
  const baseTools = AGENT_TOOL_SCOPES[agentType] || [];
  const allTools = [...new Set([...baseTools, ...additionalTools])];
  
  // Filter out orchestrator-only tools (safety check)
  return allTools.filter((toolId) => !ORCHESTRATOR_ONLY_TOOL_IDS.has(toolId));
}

/**
 * Check if a tool is accessible to an agent type.
 */
export function canAgentUseTool(
  agentType: AgentType,
  toolId: string,
  additionalTools: string[] = []
): boolean {
  // Orchestrator-only tools are never accessible to sub-agents
  if (ORCHESTRATOR_ONLY_TOOL_IDS.has(toolId)) {
    return false;
  }
  
  const availableTools = getAgentTools(agentType, additionalTools);
  return availableTools.includes(toolId);
}

/**
 * Get a human-readable description of tools an agent can use.
 * Useful for error messages or logging.
 */
export function describeAgentToolAccess(
  agentType: AgentType,
  additionalTools: string[] = []
): string {
  const tools = getAgentTools(agentType, additionalTools);
  const capabilities = AGENT_CAPABILITIES[agentType];
  
  return `${capabilities}\n\nAvailable tools: ${tools.join(', ')}`;
}

// =============================================================================
// Memory Access (Special Rules)
// =============================================================================

/**
 * Tools that allow reading from memory/knowledge.
 * All agent types have read access.
 */
export const MEMORY_READ_TOOLS = ['recall', 'kg_query'];

/**
 * Tools that allow writing to memory/knowledge.
 * Only the orchestrator can write to memory.
 */
export const MEMORY_WRITE_TOOLS = ['remember', 'kg_create_entity', 'kg_create_relation', 'store_memory'];

/**
 * Check if a tool writes to memory.
 * Used to enforce that only the orchestrator can write.
 */
export function isMemoryWriteTool(toolId: string): boolean {
  return MEMORY_WRITE_TOOLS.includes(toolId);
}
