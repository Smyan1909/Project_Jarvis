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

export interface MockStreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullContent: string) => void;
  onError?: (error: string) => void;
}

/**
 * Streams a mock response token by token with realistic typing delays
 * @param userMessage The user's input message
 * @param callbacks Callbacks for streaming events
 * @returns A cancel function to stop the stream
 */
export function streamMockResponse(
  userMessage: string,
  callbacks: MockStreamCallbacks
): () => void {
  const response = selectResponse(userMessage);
  let currentIndex = 0;
  let isCancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const streamNextToken = () => {
    if (isCancelled || currentIndex >= response.length) {
      if (!isCancelled) {
        callbacks.onComplete(response);
      }
      return;
    }

    // Stream 1-3 characters at a time for natural feel
    const chunkSize = Math.floor(Math.random() * 3) + 1;
    const endIndex = Math.min(currentIndex + chunkSize, response.length);
    const token = response.substring(currentIndex, endIndex);

    callbacks.onToken(token);
    currentIndex = endIndex;

    // Variable delay for natural typing effect (20-60ms per chunk)
    const delay = Math.floor(Math.random() * 40) + 20;
    timeoutId = setTimeout(streamNextToken, delay);
  };

  // Start streaming after a brief "thinking" delay
  timeoutId = setTimeout(streamNextToken, 500);

  // Return cancel function
  return () => {
    isCancelled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Reset the mock agent state.
 * Useful for testing or when the user starts a new conversation.
 */
export function resetMockAgent(): void {
  isFirstMessage = true;
}
