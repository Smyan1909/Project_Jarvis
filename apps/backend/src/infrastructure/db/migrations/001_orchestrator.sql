-- =============================================================================
-- Migration: 001_orchestrator
-- Description: Create tables for orchestrator, task plans, task nodes, and sub-agents
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Task Plans (DAG Structure)
-- =============================================================================
-- Represents the overall plan for executing a user's request.
-- A plan contains multiple task nodes organized as a DAG.

CREATE TABLE IF NOT EXISTS task_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL,                           -- References agent_runs table
    status TEXT NOT NULL DEFAULT 'planning'         -- planning, executing, completed, failed
        CHECK (status IN ('planning', 'executing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up plans by run
CREATE INDEX IF NOT EXISTS idx_task_plans_run_id ON task_plans(run_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_status ON task_plans(status);

-- =============================================================================
-- Task Nodes (Nodes in the DAG)
-- =============================================================================
-- Individual tasks within a plan. Each node has:
-- - A description of what to accomplish
-- - An assigned agent type
-- - Dependencies (other tasks that must complete first)
-- - Result when completed

CREATE TABLE IF NOT EXISTS task_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES task_plans(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    agent_type TEXT NOT NULL                        -- general, research, coding, scheduling, productivity, messaging
        CHECK (agent_type IN ('general', 'research', 'coding', 'scheduling', 'productivity', 'messaging')),
    status TEXT NOT NULL DEFAULT 'pending'          -- pending, in_progress, completed, failed, cancelled
        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    dependencies UUID[] NOT NULL DEFAULT '{}',      -- Array of task node IDs this depends on
    assigned_agent_id UUID,                         -- References sub_agents table
    result JSONB,                                   -- Output from the task when completed
    retry_count INTEGER NOT NULL DEFAULT 0,         -- Number of retry attempts
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for task nodes
CREATE INDEX IF NOT EXISTS idx_task_nodes_plan_id ON task_nodes(plan_id);
CREATE INDEX IF NOT EXISTS idx_task_nodes_status ON task_nodes(status);
CREATE INDEX IF NOT EXISTS idx_task_nodes_agent_type ON task_nodes(agent_type);

-- =============================================================================
-- Sub-Agents (Agent Execution State)
-- =============================================================================
-- Tracks the state of each sub-agent spawned by the orchestrator.
-- Contains the full execution context including messages, tool calls, and reasoning.

CREATE TABLE IF NOT EXISTS sub_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL,                           -- References agent_runs table
    task_node_id UUID NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL
        CHECK (agent_type IN ('general', 'research', 'coding', 'scheduling', 'productivity', 'messaging')),
    status TEXT NOT NULL DEFAULT 'initializing'     -- initializing, running, completed, failed, cancelled
        CHECK (status IN ('initializing', 'running', 'completed', 'failed', 'cancelled')),
    
    -- Task context
    task_description TEXT NOT NULL,
    upstream_context TEXT,                          -- Context from completed dependency tasks
    additional_tools TEXT[] NOT NULL DEFAULT '{}',  -- Extra tool IDs granted by orchestrator
    
    -- Execution state (stored as JSONB for flexibility)
    messages JSONB NOT NULL DEFAULT '[]',           -- LLM message history
    tool_calls JSONB NOT NULL DEFAULT '[]',         -- Tool call records
    reasoning_steps JSONB NOT NULL DEFAULT '[]',    -- Reasoning/thinking steps
    artifacts JSONB NOT NULL DEFAULT '[]',          -- Produced artifacts
    
    -- Intervention support
    pending_guidance TEXT,                          -- Guidance injected by orchestrator
    
    -- Metrics
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost NUMERIC(12, 8) NOT NULL DEFAULT 0,   -- Cost in USD with high precision
    
    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for sub-agents
CREATE INDEX IF NOT EXISTS idx_sub_agents_run_id ON sub_agents(run_id);
CREATE INDEX IF NOT EXISTS idx_sub_agents_task_node_id ON sub_agents(task_node_id);
CREATE INDEX IF NOT EXISTS idx_sub_agents_status ON sub_agents(status);

-- =============================================================================
-- Loop Counters (For Loop Detection)
-- =============================================================================
-- Tracks retry attempts per task to prevent infinite loops.

CREATE TABLE IF NOT EXISTS loop_counters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL,                           -- References agent_runs table
    task_node_id UUID NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_retry_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_id, task_node_id)
);

-- Index for loop counters
CREATE INDEX IF NOT EXISTS idx_loop_counters_run_id ON loop_counters(run_id);

-- =============================================================================
-- Orchestrator State (Optional - for crash recovery)
-- =============================================================================
-- Stores the full orchestrator state for crash recovery.
-- This is optional since Redis is the primary hot storage.

CREATE TABLE IF NOT EXISTS orchestrator_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL UNIQUE,                    -- References agent_runs table
    user_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'planning', 'executing', 'monitoring', 'completed', 'failed')),
    
    -- State snapshots
    plan_id UUID REFERENCES task_plans(id),
    active_agent_ids UUID[] NOT NULL DEFAULT '{}',
    loop_counters JSONB NOT NULL DEFAULT '{}',      -- Map of taskNodeId -> count
    total_interventions INTEGER NOT NULL DEFAULT 0,
    
    -- Metrics
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost NUMERIC(12, 8) NOT NULL DEFAULT 0,
    
    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for orchestrator states
CREATE INDEX IF NOT EXISTS idx_orchestrator_states_user_id ON orchestrator_states(user_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_states_status ON orchestrator_states(status);

-- =============================================================================
-- Update Timestamp Trigger
-- =============================================================================
-- Automatically update the updated_at column on row modification

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to task_plans
DROP TRIGGER IF EXISTS update_task_plans_updated_at ON task_plans;
CREATE TRIGGER update_task_plans_updated_at
    BEFORE UPDATE ON task_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to orchestrator_states
DROP TRIGGER IF EXISTS update_orchestrator_states_updated_at ON orchestrator_states;
CREATE TRIGGER update_orchestrator_states_updated_at
    BEFORE UPDATE ON orchestrator_states
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
