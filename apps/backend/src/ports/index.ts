// =============================================================================
// Port Interfaces - Barrel Export
// =============================================================================
// Ports define the contracts between the application core and external adapters.
// They enable dependency inversion and make the system testable and modular.

// LLM provider interface (OpenAI, Claude, etc.)
export * from './LLMProviderPort.js';

// Tool invocation interface (local tools, MCP, Composio)
export * from './ToolInvokerPort.js';

// Vector memory storage interface
export * from './MemoryStorePort.js';

// Knowledge graph interface
export * from './KnowledgeGraphPort.js';

// Text embedding interface
export * from './EmbeddingPort.js';

// Real-time event streaming interface
export * from './EventStreamPort.js';
