// =============================================================================
// MCP Server Service
// =============================================================================
// CRUD operations for MCP server configurations
// Provides database access layer for MCP server management

import { eq } from 'drizzle-orm';
import type { MCPServerConfig, CreateMCPServerConfig, UpdateMCPServerConfig, MCPAuthConfig } from '@project-jarvis/shared-types';
import { mcpServers } from '../../infrastructure/db/schema.js';
import type { MCPConfigLoader } from '../../adapters/mcp/MCPClientManager.js';
import { logger } from '../../infrastructure/logging/logger.js';

const log = logger.child({ module: 'MCPServerService' });

/**
 * Database client type (drizzle)
 */
type DbClient = {
  select: () => {
    from: (table: typeof mcpServers) => {
      where: (condition: ReturnType<typeof eq>) => Promise<DbRow[]>;
    } & Promise<DbRow[]>;
  };
  insert: (table: typeof mcpServers) => {
    values: (values: Record<string, unknown>) => {
      returning: () => Promise<DbRow[]>;
    };
  };
  update: (table: typeof mcpServers) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: ReturnType<typeof eq>) => {
        returning: () => Promise<DbRow[]>;
      };
    };
  };
  delete: (table: typeof mcpServers) => {
    where: (condition: ReturnType<typeof eq>) => Promise<void>;
  };
};

/**
 * Database row type
 */
interface DbRow {
  id: string;
  name: string;
  description: string | null;
  url: string;
  transport: string;
  authType: string;
  authConfig: unknown;
  enabled: boolean;
  priority: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MCP Server Service
 *
 * Manages MCP server configurations in the database.
 * Implements MCPConfigLoader for use with MCPClientManager.
 */
export class MCPServerService implements MCPConfigLoader {
  constructor(private db: DbClient) {}

  /**
   * Load all enabled MCP server configurations
   *
   * Implements MCPConfigLoader interface for MCPClientManager
   */
  async loadConfigurations(): Promise<MCPServerConfig[]> {
    log.debug('Loading MCP server configurations');

    const rows = await this.db.select().from(mcpServers);
    const configs = rows.map((row) => this.rowToConfig(row));

    log.info('Loaded MCP server configurations', {
      total: configs.length,
      enabled: configs.filter((c) => c.enabled).length,
    });

    return configs;
  }

  /**
   * Get all MCP server configurations
   */
  async getAll(): Promise<MCPServerConfig[]> {
    const rows = await this.db.select().from(mcpServers);
    return rows.map((row) => this.rowToConfig(row));
  }

  /**
   * Get a specific MCP server configuration by ID
   */
  async getById(id: string): Promise<MCPServerConfig | null> {
    const rows = await this.db.select().from(mcpServers).where(eq(mcpServers.id, id));

    if (rows.length === 0) {
      return null;
    }

    return this.rowToConfig(rows[0]);
  }

  /**
   * Create a new MCP server configuration
   */
  async create(config: CreateMCPServerConfig): Promise<MCPServerConfig> {
    log.info('Creating MCP server configuration', {
      name: config.name,
      url: config.url,
      transport: config.transport,
    });

    const values = {
      name: config.name,
      description: config.description ?? null,
      url: config.url,
      transport: config.transport,
      authType: config.authType,
      authConfig: config.authConfig ?? null,
      enabled: config.enabled ?? true,
      priority: config.priority ?? 0,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 30000,
      requestTimeoutMs: config.requestTimeoutMs ?? 60000,
      maxRetries: config.maxRetries ?? 3,
    };

    const rows = await this.db.insert(mcpServers).values(values).returning();

    log.info('Created MCP server configuration', { id: rows[0].id });

    return this.rowToConfig(rows[0]);
  }

  /**
   * Update an existing MCP server configuration
   */
  async update(id: string, updates: UpdateMCPServerConfig): Promise<MCPServerConfig | null> {
    log.info('Updating MCP server configuration', { id, updates: Object.keys(updates) });

    const values: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) values.name = updates.name;
    if (updates.description !== undefined) values.description = updates.description;
    if (updates.url !== undefined) values.url = updates.url;
    if (updates.transport !== undefined) values.transport = updates.transport;
    if (updates.authType !== undefined) values.authType = updates.authType;
    if (updates.authConfig !== undefined) values.authConfig = updates.authConfig;
    if (updates.enabled !== undefined) values.enabled = updates.enabled;
    if (updates.priority !== undefined) values.priority = updates.priority;
    if (updates.connectionTimeoutMs !== undefined)
      values.connectionTimeoutMs = updates.connectionTimeoutMs;
    if (updates.requestTimeoutMs !== undefined) values.requestTimeoutMs = updates.requestTimeoutMs;
    if (updates.maxRetries !== undefined) values.maxRetries = updates.maxRetries;

    const rows = await this.db
      .update(mcpServers)
      .set(values)
      .where(eq(mcpServers.id, id))
      .returning();

    if (rows.length === 0) {
      log.warn('MCP server configuration not found for update', { id });
      return null;
    }

    log.info('Updated MCP server configuration', { id });

    return this.rowToConfig(rows[0]);
  }

  /**
   * Delete an MCP server configuration
   */
  async delete(id: string): Promise<boolean> {
    log.info('Deleting MCP server configuration', { id });

    // Check if exists first
    const existing = await this.getById(id);
    if (!existing) {
      log.warn('MCP server configuration not found for deletion', { id });
      return false;
    }

    await this.db.delete(mcpServers).where(eq(mcpServers.id, id));

    log.info('Deleted MCP server configuration', { id, name: existing.name });

    return true;
  }

  /**
   * Enable or disable an MCP server
   */
  async setEnabled(id: string, enabled: boolean): Promise<MCPServerConfig | null> {
    return this.update(id, { enabled });
  }

  /**
   * Test connection to an MCP server
   *
   * Creates a temporary client and attempts to connect
   */
  async testConnection(id: string): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    const config = await this.getById(id);
    if (!config) {
      return { success: false, error: 'Server configuration not found' };
    }

    log.info('Testing MCP server connection', { id, name: config.name });

    // Import dynamically to avoid circular dependencies
    const { MCPClientAdapter } = await import('../../adapters/mcp/MCPClientAdapter.js');

    const client = new MCPClientAdapter(config);

    try {
      await client.connect();
      const tools = await client.listTools();
      await client.disconnect();

      log.info('MCP server connection test successful', {
        id,
        name: config.name,
        toolCount: tools.length,
      });

      return { success: true, toolCount: tools.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.warn('MCP server connection test failed', {
        id,
        name: config.name,
        error: errorMessage,
      });

      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      return { success: false, error: errorMessage };
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private rowToConfig(row: DbRow): MCPServerConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      url: row.url,
      transport: row.transport as 'streamable-http' | 'sse',
      authType: row.authType as 'oauth' | 'api-key' | 'none',
      authConfig: row.authConfig as MCPAuthConfig | undefined,
      enabled: row.enabled,
      priority: row.priority,
      connectionTimeoutMs: row.connectionTimeoutMs,
      requestTimeoutMs: row.requestTimeoutMs,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Create an MCPServerService instance
 */
export function createMCPServerService(db: DbClient): MCPServerService {
  return new MCPServerService(db);
}
