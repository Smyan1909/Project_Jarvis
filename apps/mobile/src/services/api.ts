// =============================================================================
// API Service
// =============================================================================
// Axios-based HTTP client with authentication and token refresh.

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';

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
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  deleteItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    return SecureStore.deleteItemAsync(key);
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
  await Promise.all([
    storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    storage.deleteItem(ACCESS_TOKEN_KEY),
    storage.deleteItem(REFRESH_TOKEN_KEY),
  ]);
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
    return config;
  },
  (error) => Promise.reject(error)
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

        const response = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
          `${API_URL}/v1/auth/refresh`,
          { refreshToken }
        );

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        await setTokens({ accessToken, refreshToken: newRefreshToken });

        onTokenRefreshed(accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        return api(originalRequest);
      } catch (refreshError) {
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
    const response = await api.post<{ data: AuthResponse }>('/v1/auth/login', { email, password });
    return response.data.data;
  },

  register: async (email: string, password: string, displayName?: string): Promise<AuthResponse> => {
    const response = await api.post<{ data: AuthResponse }>('/v1/auth/register', {
      email,
      password,
      displayName,
    });
    return response.data.data;
  },

  logout: async (): Promise<void> => {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      await api.post('/v1/auth/logout', { refreshToken });
    }
  },

  getMe: async (): Promise<User> => {
    const response = await api.get<{ data: User }>('/v1/auth/me');
    return response.data.data;
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
    const token = await getAccessToken();
    return fetch(`${API_URL}/v1/orchestrator/run`, {
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
  },

  getRunStatus: async (runId: string) => {
    const response = await api.get<{
      runId: string;
      status: string;
      planId: string | null;
      activeAgents: number;
      totalTokens: number;
      totalCost: number;
    }>(`/v1/orchestrator/run/${runId}/status`);
    return response.data;
  },

  cancelRun: async (runId: string) => {
    const response = await api.post<{ success: boolean; message: string }>(
      `/v1/orchestrator/run/${runId}/cancel`
    );
    return response.data;
  },

  getHistory: async (limit = 50) => {
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
    return response.data;
  },

  deleteMessage: async (messageId: string) => {
    const response = await api.delete<{ success: boolean }>(`/v1/orchestrator/conversation/messages/${messageId}`);
    return response.data;
  },

  clearHistory: async () => {
    const response = await api.delete<{ success: boolean }>('/v1/orchestrator/conversation/history');
    return response.data;
  },
};

// =============================================================================
// Secrets API
// =============================================================================

export const secretsApi = {
  list: async () => {
    const response = await api.get<{
      data: Array<{
        id: string;
        provider: string;
        name: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/v1/secrets');
    return response.data.data;
  },

  create: async (provider: string, name: string, value: string) => {
    const response = await api.post<{ data: { id: string; provider: string; name: string } }>('/v1/secrets', {
      provider,
      name,
      value,
    });
    return response.data.data;
  },

  update: async (id: string, data: { name?: string; value?: string }) => {
    const response = await api.patch<{ data: { id: string; provider: string; name: string } }>(
      `/v1/secrets/${id}`,
      data
    );
    return response.data.data;
  },

  delete: async (id: string) => {
    await api.delete(`/v1/secrets/${id}`);
  },
};

// =============================================================================
// Monitoring API
// =============================================================================

export const monitoringApi = {
  // Push tokens
  registerPushToken: async (token: string, platform: 'ios' | 'android') => {
    await api.post('/v1/monitoring/push-tokens', { token, platform });
  },

  removePushToken: async (token: string) => {
    await api.delete(`/v1/monitoring/push-tokens/${encodeURIComponent(token)}`);
  },

  // Triggers
  listTriggers: async () => {
    const response = await api.get<{ subscriptions: any[] }>('/v1/monitoring/triggers');
    return response.data.subscriptions;
  },

  setupGitHubTriggers: async () => {
    const response = await api.post<{ success: boolean; subscriptions: any[] }>(
      '/v1/monitoring/triggers/setup-github'
    );
    return response.data;
  },

  // Events
  getEvents: async (limit = 50, offset = 0) => {
    const response = await api.get<{ events: any[] }>(`/v1/monitoring/events?limit=${limit}&offset=${offset}`);
    return response.data.events;
  },

  approveEvent: async (eventId: string) => {
    const response = await api.post<{ success: boolean }>(`/v1/monitoring/events/${eventId}/approve`);
    return response.data;
  },

  rejectEvent: async (eventId: string) => {
    const response = await api.post<{ success: boolean }>(`/v1/monitoring/events/${eventId}/reject`);
    return response.data;
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
    const response = await api.get<{ apps: AppWithStatus[] }>(`/v1/composio/apps?userId=${userId}`);
    return response.data;
  },

  // Get list of supported app keys
  getSupportedApps: async (): Promise<string[]> => {
    const response = await api.get<{ apps: string[] }>('/v1/composio/apps/supported');
    return response.data.apps;
  },

  // Initiate OAuth connection
  initiateConnection: async (
    userId: string,
    appKey: string,
    callbackUrl?: string
  ): Promise<ConnectionInfo> => {
    const response = await api.post<ConnectionInfo>(`/v1/composio/connect/${appKey}`, {
      userId,
      callbackUrl,
    });
    return response.data;
  },

  // Poll connection status
  getConnectionStatus: async (connectionId: string): Promise<ConnectionStatus> => {
    const response = await api.get<ConnectionStatus>(`/v1/composio/status/${connectionId}`);
    return response.data;
  },

  // List connected accounts
  listAccounts: async (userId: string) => {
    const response = await api.get<{ accounts: any[] }>(`/v1/composio/accounts?userId=${userId}`);
    return response.data.accounts;
  },

  // Disconnect account
  disconnectAccount: async (accountId: string) => {
    await api.delete(`/v1/composio/accounts/${accountId}`);
  },

  // Refresh account tokens
  refreshAccount: async (accountId: string) => {
    const response = await api.post(`/v1/composio/accounts/${accountId}/refresh`);
    return response.data;
  },
};

// =============================================================================
// Usage API
// =============================================================================

export const usageApi = {
  getUsage: async () => {
    const response = await api.get<{ data: any }>('/v1/usage');
    return response.data.data;
  },

  getDailyUsage: async () => {
    const response = await api.get<{ data: any[] }>('/v1/usage/daily');
    return response.data.data;
  },

  getCurrentMonth: async () => {
    const response = await api.get<{ data: any }>('/v1/usage/current-month');
    return response.data.data;
  },

  getRuns: async (limit = 20, offset = 0) => {
    const response = await api.get<{ data: any[]; pagination: any }>(
      `/v1/usage/runs?limit=${limit}&offset=${offset}`
    );
    return response.data;
  },
};
