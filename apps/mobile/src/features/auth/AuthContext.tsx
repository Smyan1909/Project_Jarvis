// =============================================================================
// Auth Context
// =============================================================================
// Authentication state management using React Context and useReducer.

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { authApi, setTokens, clearTokens, getAccessToken } from '../../services/api';
import { registerForPushNotifications } from '../../services/pushNotifications';
import { socketManager } from '../../services/websocket';
import { DEMO_MODE } from '../../config';

// =============================================================================
// Types
// =============================================================================

interface User {
  id: string;
  email: string;
  displayName: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: string | null;
}

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: User }
  | { type: 'AUTH_FAILURE'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'RESTORE_TOKEN'; payload: { isAuthenticated: boolean; user: User | null } }
  | { type: 'CLEAR_ERROR' };

// =============================================================================
// Reducer
// =============================================================================

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
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        user: action.payload,
        error: null,
      };
    case 'AUTH_FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, isAuthenticated: false, user: null, error: null };
    case 'RESTORE_TOKEN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: action.payload.isAuthenticated,
        user: action.payload.user,
      };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// =============================================================================
// Provider
// =============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check for existing token on mount
  useEffect(() => {
    async function checkToken() {
      // Demo mode: bypass authentication
      if (DEMO_MODE) {
        dispatch({
          type: 'AUTH_SUCCESS',
          payload: {
            id: 'demo-user-id',
            email: 'demo@jarvis.local',
            displayName: 'Demo User',
          },
        });
        return;
      }

      try {
        const token = await getAccessToken();
        if (token) {
          // Try to get user info
          try {
            const user = await authApi.getMe();
            dispatch({
              type: 'RESTORE_TOKEN',
              payload: {
                isAuthenticated: true,
                user: {
                  id: user.id,
                  email: user.email,
                  displayName: user.displayName,
                },
              },
            });

            // Connect socket and register for push notifications
            socketManager.connect().catch(console.error);
            registerForPushNotifications().catch(console.error);
          } catch (e) {
            // Token might be expired
            dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
          }
        } else {
          dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
        }
      } catch (err) {
        console.error('Error checking token:', err);
        dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
      }
    }
    checkToken();
  }, []);

  const login = async (email: string, password: string) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const { user, tokens } = await authApi.login(email, password);
      await setTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      dispatch({
        type: 'AUTH_SUCCESS',
        payload: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
      });

      // Connect socket and register for push notifications
      socketManager.connect().catch(console.error);
      registerForPushNotifications().catch(console.error);
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed';
      dispatch({ type: 'AUTH_FAILURE', payload: errorMessage });
      throw err;
    }
  };

  const register = async (email: string, password: string, displayName?: string) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const { user, tokens } = await authApi.register(email, password, displayName);
      await setTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      dispatch({
        type: 'AUTH_SUCCESS',
        payload: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
      });

      // Connect socket and register for push notifications
      socketManager.connect().catch(console.error);
      registerForPushNotifications().catch(console.error);
    } catch (err: any) {
      const errorMessage = err.message || 'Registration failed';
      dispatch({ type: 'AUTH_FAILURE', payload: errorMessage });
      throw err;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (e) {
      // Ignore logout API errors
      console.error('Logout API error:', e);
    }
    await clearTokens();
    socketManager.disconnect();
    dispatch({ type: 'LOGOUT' });
  };

  const clearError = () => {
    dispatch({ type: 'CLEAR_ERROR' });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
