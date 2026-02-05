# Frontend Developer - Implementation Guide

## Role Overview

You are responsible for the **React Native mobile app** of Project Jarvis:
- Navigation and screen structure
- Authentication flow (JWT + refresh tokens)
- Real-time chat experience with WebSocket streaming
- Settings and secrets management UI
- Tool visualization and history
- Media upload (audio/images)

## Tech Stack

- **Framework:** React Native with Expo (SDK 54)
- **Navigation:** React Navigation v6
- **State Management:** React Context + useReducer (or Zustand)
- **Networking:** Axios for REST, native WebSocket
- **Storage:** expo-secure-store for tokens, AsyncStorage for preferences
- **UI:** Custom components with a consistent design system

## Weekly Breakdown

---

## Week 1: Foundation

### Objectives
- Set up navigation structure
- Create design system (colors, typography, spacing)
- Build API client and WebSocket hook scaffolds

### Day 1-2: Navigation Setup

**Install dependencies:**
```bash
cd apps/mobile
pnpm add @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
pnpm add react-native-screens react-native-safe-area-context
```

**Create `apps/mobile/src/navigation/types.ts`:**
```typescript
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

// Auth stack (unauthenticated)
export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
};

// Main tabs (authenticated)
export type MainTabParamList = {
  Chat: undefined;
  History: undefined;
  Settings: undefined;
};

// Root stack
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  Conversation: { runId: string };
  SecretManagement: undefined;
  ToolDetails: { toolId: string };
};

// Screen props helpers
export type RootStackScreenProps<T extends keyof RootStackParamList> = 
  NativeStackScreenProps<RootStackParamList, T>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = 
  CompositeScreenProps<
    NativeStackScreenProps<AuthStackParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

export type MainTabScreenProps<T extends keyof MainTabParamList> = 
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

// Navigation prop for useNavigation hook
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
```

**Create `apps/mobile/src/navigation/RootNavigator.tsx`:**
```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../features/auth/AuthContext';
import type { RootStackParamList, AuthStackParamList, MainTabParamList } from './types';

// Screens (to be created)
import { LoginScreen } from '../screens/LoginScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { SecretManagementScreen } from '../screens/SecretManagementScreen';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8E8E93',
      }}
    >
      <MainTab.Screen 
        name="Chat" 
        component={ChatScreen}
        options={{ tabBarLabel: 'Chat' }}
      />
      <MainTab.Screen 
        name="History" 
        component={HistoryScreen}
        options={{ tabBarLabel: 'History' }}
      />
      <MainTab.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{ tabBarLabel: 'Settings' }}
      />
    </MainTab.Navigator>
  );
}

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    // Show splash/loading screen
    return null;
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <RootStack.Screen name="Main" component={MainNavigator} />
            <RootStack.Screen 
              name="Conversation" 
              component={ConversationScreen}
              options={{ headerShown: true, title: '' }}
            />
            <RootStack.Screen 
              name="SecretManagement" 
              component={SecretManagementScreen}
              options={{ headerShown: true, title: 'API Keys' }}
            />
          </>
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
```

### Day 2-3: Design System

**Create `apps/mobile/src/theme/colors.ts`:**
```typescript
export const colors = {
  // Primary
  primary: '#007AFF',
  primaryLight: '#4DA3FF',
  primaryDark: '#0055CC',

  // Backgrounds
  background: '#FFFFFF',
  backgroundSecondary: '#F2F2F7',
  backgroundTertiary: '#E5E5EA',

  // Text
  text: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textInverse: '#FFFFFF',

  // Status
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',

  // Chat
  userBubble: '#007AFF',
  assistantBubble: '#E5E5EA',
  userBubbleText: '#FFFFFF',
  assistantBubbleText: '#000000',

  // Borders
  border: '#C6C6C8',
  borderLight: '#E5E5EA',

  // Misc
  overlay: 'rgba(0, 0, 0, 0.4)',
  shadow: 'rgba(0, 0, 0, 0.1)',
} as const;

// Dark mode colors (for future)
export const darkColors = {
  ...colors,
  background: '#000000',
  backgroundSecondary: '#1C1C1E',
  backgroundTertiary: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#EBEBF5',
  textTertiary: '#8E8E93',
  assistantBubble: '#2C2C2E',
  assistantBubbleText: '#FFFFFF',
  border: '#38383A',
  borderLight: '#2C2C2E',
} as const;

export type Colors = typeof colors;
```

**Create `apps/mobile/src/theme/typography.ts`:**
```typescript
import { TextStyle } from 'react-native';

export const typography = {
  // Headings
  h1: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 41,
    letterSpacing: 0.37,
  } as TextStyle,
  
  h2: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: 0.36,
  } as TextStyle,
  
  h3: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: 0.35,
  } as TextStyle,

  // Body
  body: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 22,
    letterSpacing: -0.41,
  } as TextStyle,

  bodySmall: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: -0.24,
  } as TextStyle,

  // Captions
  caption: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    letterSpacing: -0.08,
  } as TextStyle,

  captionSmall: {
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 13,
    letterSpacing: 0.07,
  } as TextStyle,

  // Buttons
  button: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: -0.41,
  } as TextStyle,

  buttonSmall: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: -0.24,
  } as TextStyle,
} as const;

export type Typography = typeof typography;
```

**Create `apps/mobile/src/theme/spacing.ts`:**
```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
```

**Create `apps/mobile/src/theme/index.ts`:**
```typescript
import { colors, darkColors } from './colors';
import { typography } from './typography';
import { spacing, borderRadius } from './spacing';

export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
} as const;

export const darkTheme = {
  ...theme,
  colors: darkColors,
} as const;

export type Theme = typeof theme;

export * from './colors';
export * from './typography';
export * from './spacing';
```

### Day 3-4: API Client

**Install axios:**
```bash
pnpm add axios
```

**Create `apps/mobile/src/services/api.ts`:**
```typescript
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';

// Token keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// Types
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface ApiError {
  code: string;
  message: string;
}

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token management
export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setTokens(tokens: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

// Request interceptor - add auth header
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error: ApiError }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 errors
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Wait for token refresh
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post<{ data: TokenPair }>(`${API_URL}/v1/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        await setTokens({ accessToken, refreshToken: newRefreshToken });

        onTokenRefreshed(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed - clear tokens and redirect to login
        await clearTokens();
        // The auth context will handle the redirect
        throw refreshError;
      } finally {
        isRefreshing = false;
      }
    }

    // Transform error for easier handling
    const apiError = error.response?.data?.error || {
      code: 'NETWORK_ERROR',
      message: error.message || 'Network error occurred',
    };

    return Promise.reject(apiError);
  }
);

export default api;

// API methods
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ data: TokenPair }>('/v1/auth/login', { email, password }),
  
  register: (email: string, password: string, displayName?: string) =>
    api.post<{ data: TokenPair }>('/v1/auth/register', { email, password, displayName }),
  
  logout: async () => {
    const refreshToken = await getRefreshToken();
    return api.post('/v1/auth/logout', { refreshToken });
  },
};

export const agentApi = {
  startRun: (input: string, model?: string) =>
    api.post<{ data: { id: string; status: string; startedAt: string } }>('/v1/agent/run', { input, model }),
  
  getRunStatus: (runId: string) =>
    api.get<{ data: any }>(`/v1/agent/${runId}/status`),
  
  getRunMessages: (runId: string) =>
    api.get<{ data: any[] }>(`/v1/agent/${runId}/messages`),
  
  cancelRun: (runId: string) =>
    api.post(`/v1/agent/${runId}/cancel`),
  
  listRuns: (limit = 20, offset = 0) =>
    api.get<{ data: any[]; pagination: any }>(`/v1/agent?limit=${limit}&offset=${offset}`),
};

export const secretsApi = {
  list: () =>
    api.get<{ data: any[] }>('/v1/secrets'),
  
  create: (provider: string, name: string, value: string) =>
    api.post<{ data: any }>('/v1/secrets', { provider, name, value }),
  
  update: (id: string, data: { name?: string; value?: string }) =>
    api.patch<{ data: any }>(`/v1/secrets/${id}`, data),
  
  delete: (id: string) =>
    api.delete(`/v1/secrets/${id}`),
};
```

### Day 4-5: WebSocket Hook

**Create `apps/mobile/src/services/websocket.ts`:**
```typescript
import { getAccessToken } from './api';
import { WS_URL } from '../config';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WebSocketManager {
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribe: (runId: string, callback: (event: AgentEvent) => void) => () => void;
  getStatus: () => ConnectionStatus;
  onStatusChange: (callback: (status: ConnectionStatus) => void) => () => void;
}

// Agent event types (from shared-types)
export type AgentEvent =
  | { type: 'agent.token'; token: string }
  | { type: 'agent.tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'agent.tool_result'; toolId: string; output: unknown; success: boolean }
  | { type: 'agent.final'; content: string; usage?: { totalTokens: number; totalCost: number } }
  | { type: 'agent.error'; message: string; code?: string }
  | { type: 'agent.status'; status: 'running' | 'completed' | 'failed' | 'cancelled' };

export function createWebSocketManager(): WebSocketManager {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const runListeners = new Map<string, Set<(event: AgentEvent) => void>>();

  function setStatus(newStatus: ConnectionStatus) {
    status = newStatus;
    statusListeners.forEach(cb => cb(status));
  }

  async function connect(): Promise<void> {
    if (socket?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');

    const token = await getAccessToken();
    if (!token) {
      setStatus('error');
      throw new Error('No access token available');
    }

    return new Promise((resolve, reject) => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        // Authenticate
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle auth response
          if (data.type === 'auth.success') {
            setStatus('connected');
            reconnectAttempts = 0;
            resolve();
            return;
          }

          if (data.type === 'auth.error') {
            setStatus('error');
            reject(new Error(data.message));
            return;
          }

          // Handle run events
          if (data.runId && runListeners.has(data.runId)) {
            runListeners.get(data.runId)?.forEach(cb => cb(data.event));
          }

          // Handle global agent events (format: run:<runId>)
          const runIdMatch = data.channel?.match(/^run:(.+)$/);
          if (runIdMatch && runListeners.has(runIdMatch[1])) {
            runListeners.get(runIdMatch[1])?.forEach(cb => cb(data.event));
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
      };

      socket.onclose = () => {
        setStatus('disconnected');
        socket = null;

        // Attempt reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimeout = setTimeout(() => {
            connect().catch(console.error);
          }, delay);
        }
      };
    });
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    reconnectAttempts = maxReconnectAttempts; // Prevent reconnect
    socket?.close();
    socket = null;
    setStatus('disconnected');
  }

  function subscribe(runId: string, callback: (event: AgentEvent) => void): () => void {
    if (!runListeners.has(runId)) {
      runListeners.set(runId, new Set());
    }
    runListeners.get(runId)!.add(callback);

    // Subscribe to run channel
    socket?.send(JSON.stringify({ type: 'subscribe', channel: `run:${runId}` }));

    return () => {
      runListeners.get(runId)?.delete(callback);
      if (runListeners.get(runId)?.size === 0) {
        runListeners.delete(runId);
        socket?.send(JSON.stringify({ type: 'unsubscribe', channel: `run:${runId}` }));
      }
    };
  }

  function getStatus(): ConnectionStatus {
    return status;
  }

  function onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    statusListeners.add(callback);
    return () => statusListeners.delete(callback);
  }

  return {
    connect,
    disconnect,
    subscribe,
    getStatus,
    onStatusChange,
  };
}

// Singleton instance
export const wsManager = createWebSocketManager();
```

**Create `apps/mobile/src/hooks/useAgentStream.ts`:**
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { agentApi } from '../services/api';
import { wsManager, AgentEvent } from '../services/websocket';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'success' | 'error';
}

interface UseAgentStreamResult {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  cancelRun: () => void;
}

export function useAgentStream(): UseAgentStreamResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>('');

  // Connect WebSocket on mount
  useEffect(() => {
    wsManager.connect().catch(console.error);
    return () => {
      // Don't disconnect on unmount - let it persist
    };
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'agent.token':
        streamingContentRef.current += event.token;
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, content: streamingContentRef.current },
            ];
          }
          return prev;
        });
        break;

      case 'agent.tool_call':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.role === 'assistant') {
            const toolCall: ToolCallInfo = {
              id: event.toolId,
              name: event.toolName,
              input: event.input,
              status: 'pending',
            };
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                toolCalls: [...(lastMessage.toolCalls || []), toolCall],
              },
            ];
          }
          return prev;
        });
        break;

      case 'agent.tool_result':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.toolCalls) {
            const updatedToolCalls = lastMessage.toolCalls.map(tc =>
              tc.id === event.toolId
                ? { ...tc, output: event.output, status: event.success ? 'success' : 'error' as const }
                : tc
            );
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, toolCalls: updatedToolCalls },
            ];
          }
          return prev;
        });
        break;

      case 'agent.final':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, content: event.content, isStreaming: false },
            ];
          }
          return prev;
        });
        setIsLoading(false);
        break;

      case 'agent.error':
        setError(event.message);
        setIsLoading(false);
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, isStreaming: false },
            ];
          }
          return prev;
        });
        break;

      case 'agent.status':
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
          setIsLoading(false);
        }
        break;
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    setError(null);
    setIsLoading(true);
    streamingContentRef.current = '';

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder assistant message
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Start the run
      const response = await agentApi.startRun(content);
      const runId = response.data.data.id;
      currentRunIdRef.current = runId;

      // Subscribe to events
      const unsubscribe = wsManager.subscribe(runId, handleEvent);

      // Store unsubscribe for cleanup
      // In a real app, you'd want to track this better
      return () => unsubscribe();
    } catch (err: any) {
      setError(err.message || 'Failed to start conversation');
      setIsLoading(false);
      // Remove the streaming message
      setMessages(prev => prev.slice(0, -1));
    }
  }, [handleEvent]);

  const cancelRun = useCallback(() => {
    if (currentRunIdRef.current) {
      agentApi.cancelRun(currentRunIdRef.current).catch(console.error);
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    cancelRun,
  };
}
```

### Files to Create This Week

```
apps/mobile/src/
  config.ts
  navigation/
    types.ts
    RootNavigator.tsx
  theme/
    index.ts
    colors.ts
    typography.ts
    spacing.ts
  services/
    api.ts
    websocket.ts
  hooks/
    useAgentStream.ts
```

---

## Week 2: Authentication

### Objectives
- Build login and signup screens
- Implement auth context with token management
- Handle auth state persistence

### Day 1-2: Auth Context

**Create `apps/mobile/src/features/auth/AuthContext.tsx`:**
```typescript
import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { authApi, setTokens, clearTokens, getAccessToken } from '../../services/api';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { email: string } | null;
  error: string | null;
}

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: { email: string } }
  | { type: 'AUTH_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'RESTORE_TOKEN'; payload: boolean };

const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  user: null,
  error: null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, isLoading: true, error: null };
    case 'AUTH_SUCCESS':
      return { ...state, isLoading: false, isAuthenticated: true, user: action.payload, error: null };
    case 'AUTH_FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, isAuthenticated: false, user: null };
    case 'RESTORE_TOKEN':
      return { ...state, isLoading: false, isAuthenticated: action.payload };
    default:
      return state;
  }
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check for existing token on mount
  useEffect(() => {
    async function checkToken() {
      const token = await getAccessToken();
      dispatch({ type: 'RESTORE_TOKEN', payload: !!token });
    }
    checkToken();
  }, []);

  const login = async (email: string, password: string) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const response = await authApi.login(email, password);
      const { accessToken, refreshToken } = response.data.data;
      await setTokens({ accessToken, refreshToken });
      dispatch({ type: 'AUTH_SUCCESS', payload: { email } });
    } catch (err: any) {
      dispatch({ type: 'AUTH_FAILURE', payload: err.message || 'Login failed' });
      throw err;
    }
  };

  const register = async (email: string, password: string, displayName?: string) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const response = await authApi.register(email, password, displayName);
      const { accessToken, refreshToken } = response.data.data;
      await setTokens({ accessToken, refreshToken });
      dispatch({ type: 'AUTH_SUCCESS', payload: { email } });
    } catch (err: any) {
      dispatch({ type: 'AUTH_FAILURE', payload: err.message || 'Registration failed' });
      throw err;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (e) {
      // Ignore logout API errors
    }
    await clearTokens();
    dispatch({ type: 'LOGOUT' });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

### Day 2-3: Login Screen

**Create `apps/mobile/src/screens/LoginScreen.tsx`:**
```typescript
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../features/auth/AuthContext';
import { theme } from '../theme';
import type { AuthStackScreenProps } from '../navigation/types';

export function LoginScreen() {
  const navigation = useNavigation<AuthStackScreenProps<'Login'>['navigation']>();
  const { login, isLoading, error } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    try {
      await login(email, password);
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'Please check your credentials');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor={theme.colors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={theme.colors.textTertiary}
              secureTextEntry
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={theme.colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.link}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xl,
  },
  form: {
    gap: theme.spacing.md,
  },
  inputContainer: {
    gap: theme.spacing.xs,
  },
  label: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
  },
  input: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.typography.body,
    color: theme.colors.text,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.error,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
  },
  footerText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  link: {
    ...theme.typography.body,
    color: theme.colors.primary,
  },
});
```

### Day 3-4: Signup Screen

**Create `apps/mobile/src/screens/SignupScreen.tsx`:**
```typescript
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../features/auth/AuthContext';
import { theme } from '../theme';
import type { AuthStackScreenProps } from '../navigation/types';

export function SignupScreen() {
  const navigation = useNavigation<AuthStackScreenProps<'Signup'>['navigation']>();
  const { register, isLoading, error } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSignup = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    try {
      await register(email, password, displayName || undefined);
    } catch (err: any) {
      Alert.alert('Registration Failed', err.message || 'Please try again');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Sign up to get started</Text>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Display Name (optional)</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Enter your name"
                placeholderTextColor={theme.colors.textTertiary}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={theme.colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Create a password"
                placeholderTextColor={theme.colors.textTertiary}
                secureTextEntry
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm your password"
                placeholderTextColor={theme.colors.textTertiary}
                secureTextEntry
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={theme.colors.textInverse} />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.link}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xl,
  },
  form: {
    gap: theme.spacing.md,
  },
  inputContainer: {
    gap: theme.spacing.xs,
  },
  label: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
  },
  input: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.typography.body,
    color: theme.colors.text,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.error,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
  },
  footerText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  link: {
    ...theme.typography.body,
    color: theme.colors.primary,
  },
});
```

### Files to Create This Week

```
apps/mobile/src/
  features/auth/
    AuthContext.tsx
    useAuth.ts
  screens/
    LoginScreen.tsx
    SignupScreen.tsx
  components/
    Button.tsx
    Input.tsx
```

---

## Week 3: Chat Experience

### Objectives
- Build chat screen with message list
- Implement streaming message display
- Show tool call indicators

### Key Components

**Create `apps/mobile/src/screens/ChatScreen.tsx`:**
```typescript
import React, { useRef, useEffect } from 'react';
import {
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAgentStream } from '../hooks/useAgentStream';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from '../components/TypingIndicator';
import { theme } from '../theme';

export function ChatScreen() {
  const { messages, isLoading, error, sendMessage, cancelRun } = useAgentStream();
  const [input, setInput] = React.useState('');
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const message = input.trim();
    setInput('');
    await sendMessage(message);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isStreaming={item.isStreaming}
            />
          )}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Welcome to Jarvis</Text>
              <Text style={styles.emptySubtitle}>Ask me anything to get started</Text>
            </View>
          }
          ListFooterComponent={
            isLoading && messages[messages.length - 1]?.content === '' ? (
              <TypingIndicator />
            ) : null
          }
        />

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message Jarvis..."
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            maxLength={10000}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || isLoading) && styles.sendButtonDisabled]}
            onPress={isLoading ? cancelRun : handleSend}
            disabled={!input.trim() && !isLoading}
          >
            <Text style={styles.sendButtonText}>
              {isLoading ? 'Stop' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  messageList: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    ...theme.typography.h2,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  errorBanner: {
    backgroundColor: theme.colors.error,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  errorText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textInverse,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
    backgroundColor: theme.colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    ...theme.typography.body,
    color: theme.colors.text,
    maxHeight: 120,
  },
  sendButton: {
    marginLeft: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.backgroundTertiary,
  },
  sendButtonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
});
```

**Create `apps/mobile/src/components/MessageBubble.tsx`:**
```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { ToolCallCard } from './ToolCallCard';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'success' | 'error';
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
          {message.content}
          {isStreaming && <Text style={styles.cursor}>|</Text>}
        </Text>
      </View>

      {message.toolCalls?.map((tc) => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
    maxWidth: '85%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
  },
  bubble: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
  },
  userBubble: {
    backgroundColor: theme.colors.userBubble,
    borderBottomRightRadius: theme.borderRadius.sm,
  },
  assistantBubble: {
    backgroundColor: theme.colors.assistantBubble,
    borderBottomLeftRadius: theme.borderRadius.sm,
  },
  text: {
    ...theme.typography.body,
  },
  userText: {
    color: theme.colors.userBubbleText,
  },
  assistantText: {
    color: theme.colors.assistantBubbleText,
  },
  cursor: {
    color: theme.colors.primary,
  },
});
```

**Create `apps/mobile/src/components/ToolCallCard.tsx`:**
```typescript
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme';

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'success' | 'error';
}

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = {
    pending: theme.colors.warning,
    success: theme.colors.success,
    error: theme.colors.error,
  }[toolCall.status];

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.toolName}>{toolCall.name}</Text>
        <Text style={styles.expandIcon}>{expanded ? '-' : '+'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.details}>
          <Text style={styles.detailLabel}>Input:</Text>
          <Text style={styles.detailValue}>
            {JSON.stringify(toolCall.input, null, 2)}
          </Text>
          
          {toolCall.output && (
            <>
              <Text style={styles.detailLabel}>Output:</Text>
              <Text style={styles.detailValue}>
                {JSON.stringify(toolCall.output, null, 2)}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing.sm,
  },
  toolName: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  expandIcon: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
  },
  details: {
    padding: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
  },
  detailLabel: {
    ...theme.typography.caption,
    color: theme.colors.textTertiary,
    marginBottom: theme.spacing.xs,
  },
  detailValue: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: theme.spacing.sm,
  },
});
```

### Files to Create This Week

```
apps/mobile/src/
  screens/
    ChatScreen.tsx
  components/
    MessageBubble.tsx
    ToolCallCard.tsx
    TypingIndicator.tsx
```

---

## Week 4: Settings & Secrets

### Objectives
- Build settings screen
- Implement secrets management UI
- Add conversation history screen

### Key Screens

**Create `apps/mobile/src/screens/SettingsScreen.tsx`:**
```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../features/auth/AuthContext';
import { theme } from '../theme';

export function SettingsScreen() {
  const navigation = useNavigation();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Keys</Text>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('SecretManagement')}
          >
            <Text style={styles.menuItemText}>Manage API Keys</Text>
            <Text style={styles.menuItemArrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Version</Text>
            <Text style={styles.value}>1.0.0</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    ...theme.typography.caption,
    color: theme.colors.textTertiary,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  label: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  value: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
  menuItem: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemText: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
  menuItemArrow: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
  },
  logoutButton: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  logoutText: {
    ...theme.typography.body,
    color: theme.colors.error,
  },
});
```

**Create `apps/mobile/src/screens/SecretManagementScreen.tsx`:**
```typescript
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { secretsApi } from '../services/api';
import { theme } from '../theme';

interface Secret {
  id: string;
  provider: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'composio', label: 'Composio' },
  { value: 'github', label: 'GitHub' },
  { value: 'custom', label: 'Custom' },
];

export function SecretManagementScreen() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  // Form state
  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    loadSecrets();
  }, []);

  const loadSecrets = async () => {
    try {
      const response = await secretsApi.list();
      setSecrets(response.data.data);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name || !value) {
      Alert.alert('Error', 'Please enter a name and value');
      return;
    }

    try {
      await secretsApi.create(provider, name, value);
      setShowModal(false);
      setName('');
      setValue('');
      loadSecrets();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleDelete = (secret: Secret) => {
    Alert.alert(
      'Delete API Key',
      `Are you sure you want to delete "${secret.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await secretsApi.delete(secret.id);
              loadSecrets();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const renderSecretItem = ({ item }: { item: Secret }) => (
    <View style={styles.secretItem}>
      <View style={styles.secretInfo}>
        <Text style={styles.secretName}>{item.name}</Text>
        <Text style={styles.secretProvider}>
          {PROVIDERS.find(p => p.value === item.provider)?.label || item.provider}
        </Text>
      </View>
      <TouchableOpacity onPress={() => handleDelete(item)}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={secrets}
        keyExtractor={(item) => item.id}
        renderItem={renderSecretItem}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No API Keys</Text>
            <Text style={styles.emptySubtitle}>Add your API keys to use external services</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      <TouchableOpacity style={styles.addButton} onPress={() => setShowModal(true)}>
        <Text style={styles.addButtonText}>Add API Key</Text>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add API Key</Text>
            <TouchableOpacity onPress={handleCreate}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Provider</Text>
              <View style={styles.providerPicker}>
                {PROVIDERS.map((p) => (
                  <TouchableOpacity
                    key={p.value}
                    style={[
                      styles.providerOption,
                      provider === p.value && styles.providerOptionSelected,
                    ]}
                    onPress={() => setProvider(p.value)}
                  >
                    <Text
                      style={[
                        styles.providerOptionText,
                        provider === p.value && styles.providerOptionTextSelected,
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g., My OpenAI Key"
                placeholderTextColor={theme.colors.textTertiary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>API Key</Text>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder="sk-..."
                placeholderTextColor={theme.colors.textTertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    flexGrow: 1,
  },
  secretItem: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  secretInfo: {
    flex: 1,
  },
  secretName: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
  secretProvider: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  deleteText: {
    ...theme.typography.body,
    color: theme.colors.error,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    ...theme.typography.h3,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptySubtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: theme.colors.primary,
    marginHorizontal: theme.spacing.lg,
    marginVertical: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  addButtonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  modalTitle: {
    ...theme.typography.h3,
    color: theme.colors.text,
  },
  cancelText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  saveText: {
    ...theme.typography.body,
    color: theme.colors.primary,
  },
  form: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  inputGroup: {
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
  },
  input: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.typography.body,
    color: theme.colors.text,
  },
  providerPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  providerOption: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  providerOptionSelected: {
    backgroundColor: theme.colors.primary,
  },
  providerOptionText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textSecondary,
  },
  providerOptionTextSelected: {
    color: theme.colors.textInverse,
  },
});
```

### Files to Create This Week

```
apps/mobile/src/
  screens/
    SettingsScreen.tsx
    SecretManagementScreen.tsx
    HistoryScreen.tsx
  components/
    SecretCard.tsx
```

---

## Week 5-6: Tools, Media & Polish

### Week 5: Tool Discovery & OAuth

- Tool discovery screen
- OAuth connection flow (for Composio tools)
- Connected apps list
- Tool usage history

### Week 6: Polish & Accessibility

- Media upload (audio)
- Offline queue
- Animations & transitions
- Screen reader support
- Dark mode

---

## Testing Checklist

### Manual Testing
- [ ] Auth flow (login, signup, logout, token refresh)
- [ ] Chat streaming
- [ ] Tool call display
- [ ] Secrets CRUD
- [ ] Navigation flows

### Device Testing
- [ ] iOS simulator
- [ ] Android emulator
- [ ] Physical iOS device
- [ ] Physical Android device

---

## Coordination with Backend Developers

### With Backend Dev 1
- **Week 2:** Confirm JWT payload structure
- **Week 2:** Confirm API error response format
- **Week 3:** Test WebSocket authentication flow

### With Backend Dev 2
- **Week 3:** Confirm WebSocket event types match shared-types
- **Week 4:** Test tool call display with real tool calls

---

## Quick Reference

### Run the App
```bash
cd apps/mobile
pnpm start           # Start Expo
pnpm ios             # iOS simulator
pnpm android         # Android emulator
```

### Build for Testing
```bash
pnpm expo build:ios
pnpm expo build:android
```
