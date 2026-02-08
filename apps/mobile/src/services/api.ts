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
