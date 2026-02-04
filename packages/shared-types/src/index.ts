export type AgentEvent =
  | { type: "agent.token"; token: string }
  | { type: "agent.tool_call"; toolId: string; input: unknown }
  | { type: "agent.tool_result"; toolId: string; output: unknown }
  | { type: "agent.final"; content: string }
  | { type: "agent.error"; message: string };
