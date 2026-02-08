-- =============================================================================
-- Migration: 004_tool_permissions.sql
-- Description: Add user tool permissions table for per-tool access control
-- =============================================================================

-- Create user_tool_permissions table
CREATE TABLE IF NOT EXISTS user_tool_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id VARCHAR(255) NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for efficient lookups
-- Primary lookup: check if user has permission for a specific tool
CREATE INDEX IF NOT EXISTS user_tool_permissions_user_tool_idx 
ON user_tool_permissions (user_id, tool_id);

-- Secondary lookup: find all permissions for a user
CREATE INDEX IF NOT EXISTS user_tool_permissions_user_id_idx 
ON user_tool_permissions (user_id);

-- Tertiary lookup: find all users with access to a specific tool
CREATE INDEX IF NOT EXISTS user_tool_permissions_tool_id_idx 
ON user_tool_permissions (tool_id);

-- Unique constraint: one permission entry per user per tool
CREATE UNIQUE INDEX IF NOT EXISTS user_tool_permissions_unique_idx 
ON user_tool_permissions (user_id, tool_id);

-- Add comment for documentation
COMMENT ON TABLE user_tool_permissions IS 'Per-user tool access control. If a row exists with granted=true, user has explicit access. If granted=false, user is explicitly denied.';
