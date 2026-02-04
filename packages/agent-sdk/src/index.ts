import type { AgentEvent } from "@project-jarvis/shared-types";

export interface AgentRunRequest {
  userId: string;
  input: string;
}

export interface AgentRunStream {
  onEvent(cb: (event: AgentEvent) => void): void;
  cancel(): Promise<void>;
}
