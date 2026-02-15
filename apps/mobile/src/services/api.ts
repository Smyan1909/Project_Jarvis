// =============================================================================
// API Service
// =============================================================================
// Axios-based HTTP client with authentication and token refresh.

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';
import { logger } from '../utils/logger';

// =============================================================================
// Token Keys
// =============================================================================

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// =============================================================================
// Platform-aware Storage (SecureStore for native, localStorage for web)
// =============================================================================

const storage = {
  getItem: async (key: string): Promise<string | null> => {
    logger.debug('Storage', `Getting item: ${key}`);
    if (Platform.OS === 'web') {
      const value = localStorage.getItem(key);
      logger.debug('Storage', `Retrieved from localStorage: ${key} = ${value ? '[exists]' : '[null]'}`);
      return value;
    }
    const value = await SecureStore.getItemAsync(key);
    logger.debug('Storage', `Retrieved from SecureStore: ${key} = ${value ? '[exists]' : '[null]'}`);
    return value;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    logger.debug('Storage', `Setting item: ${key}`);
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      logger.debug('Storage', `Saved to localStorage: ${key}`);
      return;
    }
    await SecureStore.setItemAsync(key, value);
    logger.debug('Storage', `Saved to SecureStore: ${key}`);
  },
  deleteItem: async (key: string): Promise<void> => {
    logger.debug('Storage', `Deleting item: ${key}`);
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      logger.debug('Storage', `Deleted from localStorage: ${key}`);
      return;
    }
    await SecureStore.deleteItemAsync(key);
    logger.debug('Storage', `Deleted from SecureStore: ${key}`);
  },
};

// =============================================================================
// Types
// =============================================================================

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface ApiError {
  code: string;
  message: string;
}

interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

interface AuthResponse {
  user: User;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

// =============================================================================
// Axios Instance
// =============================================================================

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// =============================================================================
// Token Management
// =============================================================================

export async function getAccessToken(): Promise<string | null> {
  return storage.getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return storage.getItem(REFRESH_TOKEN_KEY);
}

export async function setTokens(tokens: TokenPair): Promise<void> {
  logger.info('Auth', 'Setting tokens');
  await Promise.all([
    storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
  logger.info('Auth', 'Tokens saved successfully');
}

export async function clearTokens(): Promise<void> {
  logger.info('Auth', 'Clearing tokens');
  await Promise.all([
    storage.deleteItem(ACCESS_TOKEN_KEY),
    storage.deleteItem(REFRESH_TOKEN_KEY),
  ]);
  logger.info('Auth', 'Tokens cleared successfully');
}

// =============================================================================
// Request Interceptor
// =============================================================================

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    logger.debug('API', `${config.method?.toUpperCase()} ${config.url}`, { hasAuth: !!token });
    return config;
  },
  (error) => {
    logger.error('API', 'Request interceptor error', error);
    return Promise.reject(error);
  }
);

// =============================================================================
// Response Interceptor - Token Refresh
// =============================================================================

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  (response) => {
    logger.debug('API', `Response: ${response.status} ${response.config.url}`);
    return response;
  },
  async (error: AxiosError<{ error: ApiError }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    
    logger.error('API', `Response error: ${error.response?.status} ${originalRequest?.url}`, { 
      code: error.code,
      message: error.message 
    });

    // Handle 401 errors
    if (error.response?.status === 401 && !originalRequest._retry) {
      logger.warn('Auth', 'Token expired, attempting refresh');
      
      if (isRefreshing) {
        logger.debug('Auth', 'Waiting for token refresh in progress');
        // Wait for token refresh
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            logger.debug('Auth', 'Retrying request with new token');
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          logger.error('Auth', 'No refresh token available');
          throw new Error('No refresh token');
        }

        logger.info('Auth', 'Refreshing access token');
        const response = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
          `${API_URL}/v1/auth/refresh`,
          { refreshToken }
        );

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        await setTokens({ accessToken, refreshToken: newRefreshToken });
        logger.info('Auth', 'Token refresh successful');

        onTokenRefreshed(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        return api(originalRequest);
      } catch (refreshError) {
        logger.error('Auth', 'Token refresh failed', refreshError);
        // Refresh failed - clear tokens
        await clearTokens();
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

// =============================================================================
// Auth API
// =============================================================================

export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    logger.info('Auth', 'Login attempt', { email });
    try {
      const response = await api.post<{ data: AuthResponse }>('/v1/auth/login', { email, password });
      logger.info('Auth', 'Login successful', { userId: response.data.data.user.id });
      return response.data.data;
    } catch (error) {
      logger.error('Auth', 'Login failed', error);
      throw error;
    }
  },

  register: async (email: string, password: string, displayName?: string): Promise<AuthResponse> => {
    logger.info('Auth', 'Registration attempt', { email, displayName });
    try {
      const response = await api.post<{ data: AuthResponse }>('/v1/auth/register', {
        email,
        password,
        displayName,
      });
      logger.info('Auth', 'Registration successful', { userId: response.data.data.user.id });
      return response.data.data;
    } catch (error) {
      logger.error('Auth', 'Registration failed', error);
      throw error;
    }
  },

  logout: async (): Promise<void> => {
    logger.info('Auth', 'Logout attempt');
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try {
        await api.post('/v1/auth/logout', { refreshToken });
        logger.info('Auth', 'Logout successful');
      } catch (error) {
        logger.error('Auth', 'Logout API error', error);
        throw error;
      }
    } else {
      logger.warn('Auth', 'Logout called but no refresh token found');
    }
  },

  getMe: async (): Promise<User> => {
    logger.debug('Auth', 'Fetching current user');
    try {
      const response = await api.get<{ data: User }>('/v1/auth/me');
      logger.debug('Auth', 'Current user fetched', { userId: response.data.data.id });
      return response.data.data;
    } catch (error) {
      logger.error('Auth', 'Failed to fetch current user', error);
      throw error;
    }
  },
};

// =============================================================================
// Orchestrator API
// =============================================================================

export const orchestratorApi = {
  /**
   * Start an orchestrator run. Returns a Response object for SSE streaming.
   * Use with fetch streaming API, not axios.
   */
  startRun: async (input: string, model?: string, signal?: AbortSignal): Promise<Response> => {
    logger.info('Orchestrator', 'Starting run', { inputLength: input.length, model });
    const token = await getAccessToken();
    try {
      const response = await fetch(`${API_URL}/v1/orchestrator/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input, model }),
        signal,
        // Enable text streaming for react-native-fetch-api polyfill
        reactNative: { textStreaming: true },
      });
      logger.info('Orchestrator', 'Run started', { status: response.status });
      return response;
    } catch (error) {
      logger.error('Orchestrator', 'Failed to start run', error);
      throw error;
    }
  },

  getRunStatus: async (runId: string) => {
    logger.debug('Orchestrator', 'Getting run status', { runId });
    const response = await api.get<{
      runId: string;
      status: string;
      planId: string | null;
      activeAgents: number;
      totalTokens: number;
      totalCost: number;
    }>(`/v1/orchestrator/run/${runId}/status`);
    logger.debug('Orchestrator', 'Run status received', { runId, status: response.data.status });
    return response.data;
  },

  cancelRun: async (runId: string) => {
    logger.info('Orchestrator', 'Cancelling run', { runId });
    const response = await api.post<{ success: boolean; message: string }>(
      `/v1/orchestrator/run/${runId}/cancel`
    );
    logger.info('Orchestrator', 'Run cancelled', { runId, success: response.data.success });
    return response.data;
  },

  getHistory: async (limit = 50) => {
    logger.debug('Orchestrator', 'Fetching conversation history', { limit });
    const response = await api.get<{
      messages: Array<{
        id: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        metadata?: unknown;
        createdAt: string;
      }>;
      totalCount: number;
      hasMore: boolean;
    }>(`/v1/orchestrator/conversation/history?limit=${limit}`);
    logger.debug('Orchestrator', 'Conversation history fetched', { 
      count: response.data.messages.length, 
      total: response.data.totalCount 
    });
    return response.data;
  },

  deleteMessage: async (messageId: string) => {
    logger.info('Orchestrator', 'Deleting message', { messageId });
    const response = await api.delete<{ success: boolean }>(`/v1/orchestrator/conversation/messages/${messageId}`);
    logger.info('Orchestrator', 'Message deleted', { messageId, success: response.data.success });
    return response.data;
  },

  clearHistory: async () => {
    logger.info('Orchestrator', 'Clearing conversation history');
    const response = await api.delete<{ success: boolean }>('/v1/orchestrator/conversation/history');
    logger.info('Orchestrator', 'Conversation history cleared', { success: response.data.success });
    return response.data;
  },
};

// =============================================================================
// Secrets API
// =============================================================================

export const secretsApi = {
  list: async () => {
    logger.debug('Secrets', 'Listing secrets');
    const response = await api.get<{
      data: Array<{
        id: string;
        provider: string;
        name: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/v1/secrets');
    logger.debug('Secrets', `Found ${response.data.data.length} secrets`);
    return response.data.data;
  },

  create: async (provider: string, name: string, value: string) => {
    logger.info('Secrets', 'Creating secret', { provider, name });
    try {
      const response = await api.post<{ data: { id: string; provider: string; name: string } }>('/v1/secrets', {
        provider,
        name,
        value,
      });
      logger.info('Secrets', 'Secret created', { id: response.data.data.id });
      return response.data.data;
    } catch (error) {
      logger.error('Secrets', 'Failed to create secret', error);
      throw error;
    }
  },

  update: async (id: string, data: { name?: string; value?: string }) => {
    logger.info('Secrets', 'Updating secret', { id, name: data.name });
    try {
      const response = await api.patch<{ data: { id: string; provider: string; name: string } }>(
        `/v1/secrets/${id}`,
        data
      );
      logger.info('Secrets', 'Secret updated', { id });
      return response.data.data;
    } catch (error) {
      logger.error('Secrets', 'Failed to update secret', error);
      throw error;
    }
  },

  delete: async (id: string) => {
    logger.info('Secrets', 'Deleting secret', { id });
    try {
      await api.delete(`/v1/secrets/${id}`);
      logger.info('Secrets', 'Secret deleted', { id });
    } catch (error) {
      logger.error('Secrets', 'Failed to delete secret', error);
      throw error;
    }
  },
};

// =============================================================================
// Monitoring API
// =============================================================================

export const monitoringApi = {
  // Push tokens
  registerPushToken: async (token: string, platform: 'ios' | 'android') => {
    logger.info('Monitoring', 'Registering push token', { platform });
    try {
      await api.post('/v1/monitoring/push-tokens', { token, platform });
      logger.info('Monitoring', 'Push token registered');
    } catch (error) {
      logger.error('Monitoring', 'Failed to register push token', error);
      throw error;
    }
  },

  removePushToken: async (token: string) => {
    logger.info('Monitoring', 'Removing push token');
    try {
      await api.delete(`/v1/monitoring/push-tokens/${encodeURIComponent(token)}`);
      logger.info('Monitoring', 'Push token removed');
    } catch (error) {
      logger.error('Monitoring', 'Failed to remove push token', error);
      throw error;
    }
  },

  // Triggers
  listTriggers: async () => {
    logger.debug('Monitoring', 'Listing triggers');
    const response = await api.get<{ subscriptions: any[] }>('/v1/monitoring/triggers');
    logger.debug('Monitoring', `Found ${response.data.subscriptions.length} triggers`);
    return response.data.subscriptions;
  },

  setupGitHubTriggers: async () => {
    logger.info('Monitoring', 'Setting up GitHub triggers');
    try {
      const response = await api.post<{ success: boolean; subscriptions: any[] }>(
        '/v1/monitoring/triggers/setup-github'
      );
      logger.info('Monitoring', 'GitHub triggers setup complete', { success: response.data.success });
      return response.data;
    } catch (error) {
      logger.error('Monitoring', 'Failed to setup GitHub triggers', error);
      throw error;
    }
  },

  // Events
  getEvents: async (limit = 50, offset = 0) => {
    logger.debug('Monitoring', 'Fetching events', { limit, offset });
    const response = await api.get<{ events: any[] }>(`/v1/monitoring/events?limit=${limit}&offset=${offset}`);
    logger.debug('Monitoring', `Fetched ${response.data.events.length} events`);
    return response.data.events;
  },

  approveEvent: async (eventId: string) => {
    logger.info('Monitoring', 'Approving event', { eventId });
    try {
      const response = await api.post<{ success: boolean }>(`/v1/monitoring/events/${eventId}/approve`);
      logger.info('Monitoring', 'Event approved', { eventId, success: response.data.success });
      return response.data;
    } catch (error) {
      logger.error('Monitoring', 'Failed to approve event', error);
      throw error;
    }
  },

  rejectEvent: async (eventId: string) => {
    logger.info('Monitoring', 'Rejecting event', { eventId });
    try {
      const response = await api.post<{ success: boolean }>(`/v1/monitoring/events/${eventId}/reject`);
      logger.info('Monitoring', 'Event rejected', { eventId, success: response.data.success });
      return response.data;
    } catch (error) {
      logger.error('Monitoring', 'Failed to reject event', error);
      throw error;
    }
  },
};

// =============================================================================
// Composio API (Integrations)
// =============================================================================

export interface AppWithStatus {
  key: string;
  slug: string;
  name: string;
  description?: string;
  isConnected: boolean;
  connectedAccountId?: string;
}

export interface ConnectionInfo {
  connectionId: string;
  redirectUrl: string;
  expiresAt?: string;
}

export interface ConnectionStatus {
  connectionId: string;
  status: 'initiated' | 'active' | 'failed' | 'expired';
  connectedAccount?: {
    id: string;
    toolkit: { slug: string; name: string; logo?: string };
    status: string;
  };
  error?: string;
}

export const composioApi = {
  // Get apps with connection status for user
  getApps: async (userId: string): Promise<{ apps: AppWithStatus[] }> => {
    logger.debug('Composio', 'Fetching apps for user', { userId });
    const response = await api.get<{ apps: AppWithStatus[] }>(`/v1/composio/apps?userId=${userId}`);
    logger.debug('Composio', `Fetched ${response.data.apps.length} apps`);
    return response.data;
  },

  // Get list of supported app keys
  getSupportedApps: async (): Promise<string[]> => {
    logger.debug('Composio', 'Fetching supported apps');
    const response = await api.get<{ apps: string[] }>('/v1/composio/apps/supported');
    logger.debug('Composio', `Found ${response.data.apps.length} supported apps`);
    return response.data.apps;
  },

  // Initiate OAuth connection
  initiateConnection: async (
    userId: string,
    appKey: string,
    callbackUrl?: string
  ): Promise<ConnectionInfo> => {
    logger.info('Composio', 'Initiating OAuth connection', { userId, appKey });
    try {
      const response = await api.post<ConnectionInfo>(`/v1/composio/connect/${appKey}`, {
        userId,
        callbackUrl,
      });
      logger.info('Composio', 'OAuth connection initiated', { connectionId: response.data.connectionId });
      return response.data;
    } catch (error) {
      logger.error('Composio', 'Failed to initiate OAuth connection', error);
      throw error;
    }
  },

  // Poll connection status
  getConnectionStatus: async (connectionId: string): Promise<ConnectionStatus> => {
    logger.debug('Composio', 'Polling connection status', { connectionId });
    const response = await api.get<ConnectionStatus>(`/v1/composio/status/${connectionId}`);
    logger.debug('Composio', 'Connection status received', { connectionId, status: response.data.status });
    return response.data;
  },

  // List connected accounts
  listAccounts: async (userId: string) => {
    logger.debug('Composio', 'Listing connected accounts', { userId });
    const response = await api.get<{ accounts: any[] }>(`/v1/composio/accounts?userId=${userId}`);
    logger.debug('Composio', `Found ${response.data.accounts.length} connected accounts`);
    return response.data.accounts;
  },

  // Disconnect account
  disconnectAccount: async (accountId: string) => {
    logger.info('Composio', 'Disconnecting account', { accountId });
    try {
      await api.delete(`/v1/composio/accounts/${accountId}`);
      logger.info('Composio', 'Account disconnected', { accountId });
    } catch (error) {
      logger.error('Composio', 'Failed to disconnect account', error);
      throw error;
    }
  },

  // Refresh account tokens
  refreshAccount: async (accountId: string) => {
    logger.info('Composio', 'Refreshing account tokens', { accountId });
    try {
      const response = await api.post(`/v1/composio/accounts/${accountId}/refresh`);
      logger.info('Composio', 'Account tokens refreshed', { accountId });
      return response.data;
    } catch (error) {
      logger.error('Composio', 'Failed to refresh account tokens', error);
      throw error;
    }
  },
};

// =============================================================================
// Usage API
// =============================================================================

export const usageApi = {
  getUsage: async () => {
    logger.debug('Usage', 'Fetching usage stats');
    const response = await api.get<{ data: any }>('/v1/usage');
    logger.debug('Usage', 'Usage stats received');
    return response.data.data;
  },

  getDailyUsage: async () => {
    logger.debug('Usage', 'Fetching daily usage');
    const response = await api.get<{ data: any[] }>('/v1/usage/daily');
    logger.debug('Usage', `Received ${response.data.data.length} days of usage data`);
    return response.data.data;
  },

  getCurrentMonth: async () => {
    logger.debug('Usage', 'Fetching current month usage');
    const response = await api.get<{ data: any }>('/v1/usage/current-month');
    logger.debug('Usage', 'Current month usage received');
    return response.data.data;
  },

  getRuns: async (limit = 20, offset = 0) => {
    logger.debug('Usage', 'Fetching runs', { limit, offset });
    const response = await api.get<{ data: any[]; pagination: any }>(
      `/v1/usage/runs?limit=${limit}&offset=${offset}`
    );
    logger.debug('Usage', `Received ${response.data.data.length} runs`);
    return response.data;
  },
};
