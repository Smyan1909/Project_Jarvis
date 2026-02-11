// =============================================================================
// Composio Session Manager
// =============================================================================
// Manages per-user Composio Tool Router sessions for isolated tool calling.
// Each user gets their own Composio session linked to their OAuth connections.

import { eq } from 'drizzle-orm';
import type { 
  ComposioIntegrationService, 
  SessionInfo 
} from '@project-jarvis/mcp-servers';
import { users } from '../../infrastructure/db/schema.js';
import { logger } from '../../infrastructure/logging/logger.js';

const log = logger.child({ module: 'ComposioSessionManager' });

/**
 * Database client type for Composio session operations
 */
type DbClient = {
  select: () => {
    from: (table: typeof users) => {
      where: (condition: ReturnType<typeof eq>) => Promise<UserRow[]>;
    };
  };
  update: (table: typeof users) => {
    set: (values: Partial<UserRow>) => {
      where: (condition: ReturnType<typeof eq>) => Promise<unknown>;
    };
  };
};

/**
 * User row type for session operations
 */
interface UserRow {
  id: string;
  composioSessionId: string | null;
  composioMcpUrl: string | null;
}

/**
 * Default meta tools available in Composio sessions
 */
const DEFAULT_META_TOOLS = [
  'COMPOSIO_SEARCH_TOOLS',
  'COMPOSIO_MANAGE_CONNECTIONS',
  'COMPOSIO_MULTI_EXECUTE_TOOL',
  'COMPOSIO_REMOTE_WORKBENCH',
  'COMPOSIO_REMOTE_BASH_TOOL',
  'COMPOSIO_GET_TOOL_SCHEMAS',
];

/**
 * ComposioSessionManager
 * 
 * Manages per-user Composio Tool Router sessions. Each user gets their own
 * session that is linked to their Composio account and OAuth connections.
 * 
 * Sessions are created on first use and persisted to the database for
 * reuse across server restarts.
 */
export class ComposioSessionManager {
  constructor(
    private db: DbClient,
    private composioService: ComposioIntegrationService
  ) {}

  /**
   * Get an existing session or create a new one for the user.
   * 
   * This is the main entry point for getting a user's Composio session.
   * Sessions are cached in the database and reused across requests.
   * 
   * @param userId - The user's ID
   * @returns SessionInfo with MCP connection details
   */
  async getOrCreateSession(userId: string): Promise<SessionInfo> {
    log.debug('Getting or creating Composio session', { userId });

    // 1. Check if user has an existing session in DB
    const existingSession = await this.getExistingSession(userId);
    if (existingSession) {
      log.debug('Found existing Composio session', { 
        userId, 
        sessionId: existingSession.sessionId 
      });
      return existingSession;
    }

    // 2. Create a new session via Composio SDK
    log.info('Creating new Composio session', { userId });
    const newSession = await this.createAndStoreSession(userId);
    
    log.info('Created Composio session', { 
      userId, 
      sessionId: newSession.sessionId 
    });
    
    return newSession;
  }

  /**
   * Force refresh a user's session.
   * 
   * Use this when:
   * - A session becomes invalid
   * - After OAuth completion to ensure fresh credentials
   * - User requests a session reset
   * 
   * @param userId - The user's ID
   * @returns New SessionInfo
   */
  async refreshSession(userId: string): Promise<SessionInfo> {
    log.info('Refreshing Composio session', { userId });
    
    // Create new session and overwrite existing
    const newSession = await this.createAndStoreSession(userId);
    
    log.info('Refreshed Composio session', { 
      userId, 
      sessionId: newSession.sessionId 
    });
    
    return newSession;
  }

  /**
   * Check if a user has an existing session.
   * 
   * @param userId - The user's ID
   * @returns true if user has a session
   */
  async hasSession(userId: string): Promise<boolean> {
    const session = await this.getExistingSession(userId);
    return session !== null;
  }

  /**
   * Clear a user's session from the database.
   * 
   * @param userId - The user's ID
   */
  async clearSession(userId: string): Promise<void> {
    log.info('Clearing Composio session', { userId });
    
    await this.db.update(users)
      .set({
        composioSessionId: null,
        composioMcpUrl: null,
      } as Partial<UserRow>)
      .where(eq(users.id, userId));
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Get existing session from database if it exists.
   */
  private async getExistingSession(userId: string): Promise<SessionInfo | null> {
    const rows = await this.db.select()
      .from(users)
      .where(eq(users.id, userId));

    if (rows.length === 0) {
      log.warn('User not found', { userId });
      return null;
    }

    const user = rows[0];
    
    // Check if session exists
    if (!user.composioSessionId || !user.composioMcpUrl) {
      return null;
    }

    // Reconstruct SessionInfo from stored data
    return {
      sessionId: user.composioSessionId,
      mcp: {
        type: 'http',
        url: user.composioMcpUrl,
        headers: {},
      },
      metaTools: DEFAULT_META_TOOLS,
    };
  }

  /**
   * Create a new session via Composio SDK and store in database.
   */
  private async createAndStoreSession(userId: string): Promise<SessionInfo> {
    // Create session via Composio service
    const session = await this.composioService.createSession(userId, {
      manageConnections: {
        enable: true,
      },
    });

    // Store in database
    await this.db.update(users)
      .set({
        composioSessionId: session.sessionId,
        composioMcpUrl: session.mcp.url,
      } as Partial<UserRow>)
      .where(eq(users.id, userId));

    return session;
  }
}

/**
 * Factory function to create a ComposioSessionManager.
 * 
 * @param db - Drizzle database client
 * @param composioService - Composio integration service
 * @returns ComposioSessionManager instance
 */
export function createComposioSessionManager(
  db: DbClient,
  composioService: ComposioIntegrationService
): ComposioSessionManager {
  return new ComposioSessionManager(db, composioService);
}
