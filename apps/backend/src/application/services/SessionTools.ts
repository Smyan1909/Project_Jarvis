// =============================================================================
// Session Continuity Tools
// =============================================================================
// Tool registrations for coding session tracking and context continuity
// Enables the agent to track file changes, decisions, and TODOs across sessions
// and recall context from previous conversations when relevant

import type { ToolRegistry } from './ToolRegistry.js';
import type { KnowledgeGraphPort } from '../../ports/KnowledgeGraphPort.js';
import type { KGEntity, KGRelation } from '@project-jarvis/shared-types';
import { logger } from '../../infrastructure/logging/logger.js';

const log = logger.child({ service: 'SessionTools' });

// =============================================================================
// Types
// =============================================================================

/**
 * Session state tracked in-memory during a run
 * Maps runId to current session entity
 */
interface ActiveSession {
  sessionId: string;
  runId: string;
  userId: string;
  startedAt: Date;
}

// In-memory tracking of active sessions (per run)
const activeSessions = new Map<string, ActiveSession>();

// =============================================================================
// Session Tools Registration
// =============================================================================

/**
 * Register session continuity tools
 *
 * Tools:
 * - session_start: Create a new coding session (called automatically by orchestrator)
 * - session_end: Close a session with optional summary
 * - session_capture_file: Record a file modification
 * - session_capture_decision: Record an architectural/implementation decision
 * - session_add_todo: Add a TODO for future sessions
 * - session_recall: Search across sessions, decisions, and TODOs
 * - session_get_context: Get full session graph with related entities
 */
export function registerSessionTools(
  registry: ToolRegistry,
  kg: KnowledgeGraphPort
): void {
  // -------------------------------------------------------------------------
  // session_start - Create a new coding session
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_start',
      name: 'session_start',
      description:
        'Start a new coding session. This is called automatically when a conversation begins. Creates a session entity in the knowledge graph and links to the previous session if one exists.',
      parameters: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'The unique run ID for this conversation',
          },
          context: {
            type: 'string',
            description: 'Optional initial context or description for the session',
          },
        },
        required: ['runId'],
      },
    },
    async (userId, input) => {
      const runId = input.runId as string;
      const context = input.context as string | undefined;

      if (!runId) {
        return { success: false, error: 'runId is required' };
      }

      // Check if session already exists for this run
      if (activeSessions.has(runId)) {
        const existing = activeSessions.get(runId)!;
        return {
          success: true,
          sessionId: existing.sessionId,
          message: 'Session already active',
          alreadyActive: true,
        };
      }

      try {
        // Create session entity
        const sessionName = `Session ${new Date().toISOString().split('T')[0]} - ${runId.slice(0, 8)}`;
        const sessionEntity = await kg.createEntity(userId, 'coding_session', sessionName, {
          runId,
          context: context || null,
          startedAt: new Date().toISOString(),
          status: 'active',
        });

        // Track in memory
        activeSessions.set(runId, {
          sessionId: sessionEntity.id,
          runId,
          userId,
          startedAt: new Date(),
        });

        // Try to find and link to previous session
        let previousSessionId: string | null = null;
        try {
          const previousSessions = await kg.searchEntities(userId, 'coding_session', 'coding_session', 5);
          // Find the most recent session that isn't this one
          const previous = previousSessions.find((s) => s.id !== sessionEntity.id);
          if (previous) {
            previousSessionId = previous.id;
            await kg.createRelation(userId, sessionEntity.id, previous.id, 'continues_from', {
              linkedAt: new Date().toISOString(),
            });
            log.debug('Linked to previous session', { sessionId: sessionEntity.id, previousSessionId });
          }
        } catch (linkError) {
          log.warn('Failed to link to previous session', { error: linkError });
        }

        log.info('Session started', { sessionId: sessionEntity.id, runId, userId });

        return {
          success: true,
          sessionId: sessionEntity.id,
          previousSessionId,
          message: `Session started: ${sessionName}`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to start session', { error, runId, userId });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_end - Close a coding session
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_end',
      name: 'session_end',
      description:
        'End the current coding session. Updates the session with a summary and marks it as completed. Called automatically when a conversation ends.',
      parameters: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'The run ID of the session to end',
          },
          summary: {
            type: 'string',
            description: 'Optional summary of what was accomplished in this session',
          },
        },
        required: ['runId'],
      },
    },
    async (userId, input) => {
      const runId = input.runId as string;
      const summary = input.summary as string | undefined;

      const activeSession = activeSessions.get(runId);
      if (!activeSession) {
        return { success: false, error: 'No active session for this run' };
      }

      try {
        // Update session entity with end time and summary
        const endedAt = new Date();
        const durationMs = endedAt.getTime() - activeSession.startedAt.getTime();

        await kg.updateEntity(userId, activeSession.sessionId, {
          status: 'completed',
          endedAt: endedAt.toISOString(),
          durationMs,
          summary: summary || null,
        });

        // Remove from active sessions
        activeSessions.delete(runId);

        log.info('Session ended', {
          sessionId: activeSession.sessionId,
          runId,
          durationMs,
          hasSummary: !!summary,
        });

        return {
          success: true,
          sessionId: activeSession.sessionId,
          durationMs,
          message: `Session ended after ${Math.round(durationMs / 1000 / 60)} minutes`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to end session', { error, runId });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_capture_file - Record a file modification
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_capture_file',
      name: 'session_capture_file',
      description:
        'Record a file modification in the current session. This is called automatically when file tools (write, edit, delete) are used.',
      parameters: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'The run ID of the current session',
          },
          filePath: {
            type: 'string',
            description: 'Path to the file that was modified',
          },
          action: {
            type: 'string',
            description: 'Action performed: "create", "modify", "delete", "rename"',
          },
          description: {
            type: 'string',
            description: 'Optional description of what was changed',
          },
        },
        required: ['runId', 'filePath', 'action'],
      },
    },
    async (userId, input) => {
      const runId = input.runId as string;
      const filePath = input.filePath as string;
      const action = input.action as string;
      const description = input.description as string | undefined;

      const activeSession = activeSessions.get(runId);
      if (!activeSession) {
        // Session not active, skip capture silently
        log.debug('No active session for file capture', { runId, filePath });
        return { success: true, skipped: true, message: 'No active session' };
      }

      try {
        // Create file_change entity
        const fileName = filePath.split('/').pop() || filePath;
        const fileChangeEntity = await kg.createEntity(userId, 'file_change', fileName, {
          filePath,
          action,
          description: description || null,
          capturedAt: new Date().toISOString(),
        });

        // Link to session
        await kg.createRelation(userId, fileChangeEntity.id, activeSession.sessionId, 'modified_during', {
          action,
          capturedAt: new Date().toISOString(),
        });

        log.debug('File change captured', {
          sessionId: activeSession.sessionId,
          fileChangeId: fileChangeEntity.id,
          filePath,
          action,
        });

        return {
          success: true,
          fileChangeId: fileChangeEntity.id,
          message: `Captured ${action}: ${fileName}`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to capture file change', { error, runId, filePath });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_capture_decision - Record an architectural/implementation decision
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_capture_decision',
      name: 'session_capture_decision',
      description:
        'Record an architectural or implementation decision made during this session. Use this when making significant choices about design, technology, or approach that should be remembered for future context.',
      parameters: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            description: 'The decision that was made (e.g., "Use Redis for session caching instead of in-memory")',
          },
          reasoning: {
            type: 'string',
            description: 'Why this decision was made',
          },
          relatedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of file paths related to this decision',
          },
        },
        required: ['decision'],
      },
    },
    async (userId, input) => {
      const decision = input.decision as string;
      const reasoning = input.reasoning as string | undefined;
      const relatedFiles = input.relatedFiles as string[] | undefined;

      if (!decision || decision.trim().length === 0) {
        return { success: false, error: 'Decision is required' };
      }

      // Find active session (use most recent if runId not in context)
      let sessionId: string | null = null;
      const sessions = Array.from(activeSessions.values());
      for (const session of sessions) {
        if (session.userId === userId) {
          sessionId = session.sessionId;
          break;
        }
      }

      try {
        // Create decision entity
        const decisionEntity = await kg.createEntity(userId, 'decision', decision.slice(0, 100), {
          decision,
          reasoning: reasoning || null,
          relatedFiles: relatedFiles || [],
          capturedAt: new Date().toISOString(),
        });

        // Link to session if active
        if (sessionId) {
          await kg.createRelation(userId, decisionEntity.id, sessionId, 'decided_during', {
            capturedAt: new Date().toISOString(),
          });
        }

        // Link to related file changes if any
        if (relatedFiles && relatedFiles.length > 0) {
          // Search for file_change entities matching these paths
          for (const filePath of relatedFiles) {
            try {
              const fileChanges = await kg.searchEntities(userId, filePath, 'file_change', 1);
              if (fileChanges.length > 0) {
                await kg.createRelation(userId, decisionEntity.id, fileChanges[0].id, 'related_to_file', {
                  linkedAt: new Date().toISOString(),
                });
              }
            } catch {
              // Ignore errors linking to files
            }
          }
        }

        log.info('Decision captured', {
          decisionId: decisionEntity.id,
          sessionId,
          hasReasoning: !!reasoning,
          relatedFileCount: relatedFiles?.length || 0,
        });

        return {
          success: true,
          decisionId: decisionEntity.id,
          message: `Decision recorded: "${decision.slice(0, 50)}${decision.length > 50 ? '...' : ''}"`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to capture decision', { error, decision });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_add_todo - Add a TODO for future sessions
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_add_todo',
      name: 'session_add_todo',
      description:
        'Add a TODO item linked to the current session. Use this when there is work that should be completed in a future session.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The TODO item (e.g., "Add unit tests for AuthService")',
          },
          priority: {
            type: 'string',
            description: 'Priority: "high", "medium", "low" (default: "medium")',
          },
          relatedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of file paths related to this TODO',
          },
        },
        required: ['content'],
      },
    },
    async (userId, input) => {
      const content = input.content as string;
      const priority = (input.priority as string) || 'medium';
      const relatedFiles = input.relatedFiles as string[] | undefined;

      if (!content || content.trim().length === 0) {
        return { success: false, error: 'Content is required' };
      }

      // Find active session
      let sessionId: string | null = null;
      const todoSessions = Array.from(activeSessions.values());
      for (const session of todoSessions) {
        if (session.userId === userId) {
          sessionId = session.sessionId;
          break;
        }
      }

      try {
        // Create TODO entity
        const todoEntity = await kg.createEntity(userId, 'todo', content.slice(0, 100), {
          content,
          priority,
          status: 'pending',
          relatedFiles: relatedFiles || [],
          createdAt: new Date().toISOString(),
        });

        // Link to session if active
        if (sessionId) {
          await kg.createRelation(userId, todoEntity.id, sessionId, 'decided_during', {
            capturedAt: new Date().toISOString(),
          });
        }

        log.info('TODO added', {
          todoId: todoEntity.id,
          sessionId,
          priority,
        });

        return {
          success: true,
          todoId: todoEntity.id,
          priority,
          message: `TODO added: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to add TODO', { error, content });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_recall - Search across sessions, decisions, and TODOs
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_recall',
      name: 'session_recall',
      description:
        'Search for context from previous sessions, including decisions made, TODOs created, and files modified. Use this when the user references previous work or asks to continue something.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query (e.g., "auth refactor", "what was I working on", "open TODOs")',
          },
          types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional filter by entity types: "coding_session", "decision", "todo", "file_change"',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
          },
        },
      },
    },
    async (userId, input) => {
      const query = input.query as string | undefined;
      const types = input.types as string[] | undefined;
      const limit = Math.min((input.limit as number) || 10, 50);

      try {
        const results: Array<{
          type: string;
          name: string;
          properties: Record<string, unknown>;
          createdAt: string;
          relations: Array<{ type: string; targetName: string }>;
        }> = [];

        // Search relevant entity types
        const typesToSearch = types || ['coding_session', 'decision', 'todo', 'file_change'];

        for (const entityType of typesToSearch) {
          // Use the query or search by type if no query provided
          const searchQuery = query || entityType;
          const entities = await kg.searchEntities(userId, searchQuery, entityType, Math.ceil(limit / typesToSearch.length));

          for (const entity of entities) {
            // Get relations for context
            const withRelations = await kg.getEntityWithRelations(userId, entity.id, 1);

            results.push({
              type: entity.type,
              name: entity.name,
              properties: entity.properties,
              createdAt: entity.createdAt.toISOString(),
              relations: withRelations?.relations.map((r) => {
                const relatedEntity = withRelations.relatedEntities.find(
                  (e) => e.id === r.targetId || e.id === r.sourceId
                );
                return {
                  type: r.type,
                  targetName: relatedEntity?.name || 'unknown',
                };
              }) || [],
            });
          }
        }

        // Sort by createdAt descending
        results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Limit results
        const limitedResults = results.slice(0, limit);

        // Format summary
        const sessionCount = limitedResults.filter((r) => r.type === 'coding_session').length;
        const decisionCount = limitedResults.filter((r) => r.type === 'decision').length;
        const todoCount = limitedResults.filter((r) => r.type === 'todo').length;
        const fileCount = limitedResults.filter((r) => r.type === 'file_change').length;

        log.debug('Session recall', {
          query,
          resultCount: limitedResults.length,
          sessionCount,
          decisionCount,
          todoCount,
          fileCount,
        });

        return {
          found: limitedResults.length,
          summary: {
            sessions: sessionCount,
            decisions: decisionCount,
            todos: todoCount,
            fileChanges: fileCount,
          },
          results: limitedResults,
          message: limitedResults.length > 0
            ? `Found ${limitedResults.length} items: ${sessionCount} sessions, ${decisionCount} decisions, ${todoCount} TODOs, ${fileCount} file changes`
            : 'No relevant session context found',
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to recall session context', { error, query });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // session_get_context - Get full session graph with related entities
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'session_get_context',
      name: 'session_get_context',
      description:
        'Get detailed information about a specific session including all file changes, decisions, and TODOs made during that session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'ID of the session to retrieve (if not provided, uses current or most recent session)',
          },
        },
      },
    },
    async (userId, input) => {
      let sessionId = input.sessionId as string | undefined;

      // If no sessionId provided, try to find current or most recent session
      if (!sessionId) {
        // Check for active session
        const contextSessions = Array.from(activeSessions.values());
        for (const session of contextSessions) {
          if (session.userId === userId) {
            sessionId = session.sessionId;
            break;
          }
        }

        // If still no session, find most recent
        if (!sessionId) {
          const recentSessions = await kg.searchEntities(userId, 'coding_session', 'coding_session', 1);
          if (recentSessions.length > 0) {
            sessionId = recentSessions[0].id;
          }
        }
      }

      if (!sessionId) {
        return { success: false, error: 'No session found' };
      }

      try {
        const sessionWithRelations = await kg.getEntityWithRelations(userId, sessionId, 2);

        if (!sessionWithRelations) {
          return { success: false, error: 'Session not found' };
        }

        // Categorize related entities
        const fileChanges: Array<{ name: string; properties: Record<string, unknown> }> = [];
        const decisions: Array<{ name: string; properties: Record<string, unknown> }> = [];
        const todos: Array<{ name: string; properties: Record<string, unknown> }> = [];
        let previousSession: { id: string; name: string } | null = null;

        for (const entity of sessionWithRelations.relatedEntities) {
          switch (entity.type) {
            case 'file_change':
              fileChanges.push({ name: entity.name, properties: entity.properties });
              break;
            case 'decision':
              decisions.push({ name: entity.name, properties: entity.properties });
              break;
            case 'todo':
              todos.push({ name: entity.name, properties: entity.properties });
              break;
            case 'coding_session':
              // Check if this is the previous session (linked via continues_from)
              const continuesRelation = sessionWithRelations.relations.find(
                (r) => r.type === 'continues_from' && r.targetId === entity.id
              );
              if (continuesRelation) {
                previousSession = { id: entity.id, name: entity.name };
              }
              break;
          }
        }

        return {
          success: true,
          session: {
            id: sessionWithRelations.entity.id,
            name: sessionWithRelations.entity.name,
            properties: sessionWithRelations.entity.properties,
            createdAt: sessionWithRelations.entity.createdAt.toISOString(),
          },
          previousSession,
          fileChanges,
          decisions,
          todos,
          summary: {
            fileChanges: fileChanges.length,
            decisions: decisions.length,
            todos: todos.length,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to get session context', { error, sessionId });
        return { success: false, error: errorMessage };
      }
    },
    { category: 'kg' }
  );
}

// =============================================================================
// Helper Functions for Orchestrator Hooks
// =============================================================================

/**
 * Get the active session for a run
 */
export function getActiveSession(runId: string): ActiveSession | undefined {
  return activeSessions.get(runId);
}

/**
 * Check if a run has an active session
 */
export function hasActiveSession(runId: string): boolean {
  return activeSessions.has(runId);
}
