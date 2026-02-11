-- Migration: Add Composio session columns to users table
-- Purpose: Enable per-user Composio Tool Router sessions for isolated tool calling
-- Each user gets their own Composio session linked to their OAuth connections

-- Add Composio session columns
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS composio_session_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS composio_mcp_url VARCHAR(2048);

-- Add index for faster lookups when checking for existing sessions
CREATE INDEX IF NOT EXISTS idx_users_composio_session 
ON users(composio_session_id) WHERE composio_session_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.composio_session_id IS 'Composio Tool Router session ID for this user';
COMMENT ON COLUMN users.composio_mcp_url IS 'Composio MCP server URL for this user session';
