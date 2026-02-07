/**
 * Mock Agent Service
 * Provides simulated AI responses for demo mode without requiring a backend.
 */

// Track if this is the first message in the session
let isFirstMessage = true;

// Collection of mock responses that simulate an AI assistant
const MOCK_RESPONSES: Record<string, string> = {
  // Default Jarvis greeting - spoken on first message
  greeting: `Hi, this is Jarvis. How can I help you?`,

  capabilities: `I'm designed to be a helpful AI assistant that can:

1. **Answer Questions** - I can help explain concepts, provide information, and answer your queries.

2. **Code Assistance** - I can help write, review, and debug code in various programming languages.

3. **Task Management** - I can help you organize tasks, set reminders, and manage your workflow.

4. **Analysis** - I can analyze data, documents, and help you make sense of complex information.

5. **Creative Writing** - I can help with writing, brainstorming, and creative projects.

In the full version (with backend connected), I can also execute tools, search the web, and integrate with various services.`,

  joke: `Why do programmers prefer dark mode?

Because light attracts bugs! 

...I'll be here all week. Try the veal.`,

  howItWorks: `Great question! Here's how this app works:

**Architecture:**
- Built with React Native and Expo for cross-platform mobile support
- Uses React Navigation for seamless screen transitions
- Implements a clean hexagonal architecture with services, hooks, and screens

**Chat Flow:**
1. You type a message in the input field
2. The message is sent to the AI agent (or mock service in demo mode)
3. Responses stream back token-by-token for a natural feel
4. Messages are displayed in a chat bubble interface

**Demo Mode:**
Currently running without a backend, using simulated responses. Toggle this off in Settings to connect to a real AI backend.

**Tech Stack:**
- Expo SDK 54
- React Navigation 7
- TypeScript
- Secure token storage with expo-secure-store`,

  default: `That's an interesting question! In demo mode, I have a limited set of pre-configured responses.

When connected to the full backend, I would be able to:
- Process your specific query
- Use AI to generate a thoughtful response
- Execute tools and actions as needed

For now, try asking:
- "What can you do?"
- "Tell me a joke"
- "How does this app work?"

Or switch to the full backend by disabling demo mode in Settings.`,
};

/**
 * Determines which mock response to use based on user input
 */
function selectResponse(userMessage: string): string {
  // First message always gets the Jarvis greeting
  if (isFirstMessage) {
    isFirstMessage = false;
    return MOCK_RESPONSES.greeting;
  }

  const lowerMessage = userMessage.toLowerCase().trim();

  // Check for greetings
  if (
    lowerMessage.match(/^(hi|hello|hey|greetings|howdy|good morning|good afternoon|good evening)/)
  ) {
    return MOCK_RESPONSES.greeting;
  }

  // Check for capability questions
  if (
    lowerMessage.includes('what can you do') ||
    lowerMessage.includes('capabilities') ||
    lowerMessage.includes('what are you') ||
    lowerMessage.includes('help me with')
  ) {
    return MOCK_RESPONSES.capabilities;
  }

  // Check for jokes
  if (lowerMessage.includes('joke') || lowerMessage.includes('funny') || lowerMessage.includes('laugh')) {
    return MOCK_RESPONSES.joke;
  }

  // Check for how it works
  if (
    lowerMessage.includes('how does') ||
    lowerMessage.includes('how do you work') ||
    lowerMessage.includes('architecture') ||
    lowerMessage.includes('tech stack')
  ) {
    return MOCK_RESPONSES.howItWorks;
  }

  return MOCK_RESPONSES.default;
}

export interface MockResponseCallbacks {
  onResponse: (fullContent: string) => void;
  onError?: (error: string) => void;
}

/**
 * Gets the mock response immediately (no streaming).
 * Use this when you want the full response at once for TTS synchronization.
 * @param userMessage The user's input message
 * @param callbacks Callbacks for response events
 */
export function getMockResponse(
  userMessage: string,
  callbacks: MockResponseCallbacks
): void {
  const response = selectResponse(userMessage);
  
  // Brief "thinking" delay before returning response
  setTimeout(() => {
    callbacks.onResponse(response);
  }, 300);
}

/**
 * Reset the mock agent state.
 * Useful for testing or when the user starts a new conversation.
 */
export function resetMockAgent(): void {
  isFirstMessage = true;
}
