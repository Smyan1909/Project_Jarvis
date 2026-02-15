// =============================================================================
// Auth Context
// =============================================================================
// Authentication state management using React Context and useReducer.

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { authApi, setTokens, clearTokens, getAccessToken } from '../../services/api';
import { registerForPushNotifications } from '../../services/pushNotifications';
import { socketManager } from '../../services/websocket';
import { DEMO_MODE } from '../../config';
import { logger } from '../../utils/logger';

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
  logger.debug('AuthReducer', `Action: ${action.type}`);
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, isLoading: true, error: null };
    case 'AUTH_SUCCESS':
      logger.info('AuthReducer', 'Auth success', { userId: action.payload.id });
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        user: action.payload,
        error: null,
      };
    case 'AUTH_FAILURE':
      logger.error('AuthReducer', 'Auth failure', { error: action.payload });
      return { ...state, isLoading: false, error: action.payload };
    case 'LOGOUT':
      logger.info('AuthReducer', 'User logged out');
      return { ...state, isAuthenticated: false, user: null, error: null };
    case 'RESTORE_TOKEN':
      logger.info('AuthReducer', 'Token restored', { 
        isAuthenticated: action.payload.isAuthenticated,
        userId: action.payload.user?.id 
      });
      return {
        ...state,
        isLoading: false,
        isAuthenticated: action.payload.isAuthenticated,
        user: action.payload.user,
      };
    case 'CLEAR_ERROR':
      logger.debug('AuthReducer', 'Error cleared');
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
    logger.info('AuthContext', 'Checking for existing token on mount');
    async function checkToken() {
      // Demo mode: bypass authentication
      if (DEMO_MODE) {
        logger.info('AuthContext', 'Demo mode - bypassing authentication');
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
        logger.debug('AuthContext', 'Token check result', { hasToken: !!token });
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
            logger.info('AuthContext', 'Connecting socket and registering for push notifications');
            socketManager.connect().catch((err) => logger.error('AuthContext', 'Socket connection error', err));
            registerForPushNotifications().catch((err) => logger.error('AuthContext', 'Push registration error', err));
          } catch (e) {
            // Token might be expired
            logger.warn('AuthContext', 'Token validation failed - token may be expired');
            dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
          }
        } else {
          logger.info('AuthContext', 'No existing token found');
          dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
        }
      } catch (err) {
        logger.error('AuthContext', 'Error checking token', err);
        dispatch({ type: 'RESTORE_TOKEN', payload: { isAuthenticated: false, user: null } });
      }
    }
    checkToken();
  }, []);

  const login = async (email: string, password: string) => {
    logger.info('AuthContext', 'Login initiated', { email });
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
      logger.info('AuthContext', 'Login successful - connecting services');
      socketManager.connect().catch((err) => logger.error('AuthContext', 'Socket connection error', err));
      registerForPushNotifications().catch((err) => logger.error('AuthContext', 'Push registration error', err));
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed';
      logger.error('AuthContext', 'Login failed', { error: errorMessage });
      dispatch({ type: 'AUTH_FAILURE', payload: errorMessage });
      throw err;
    }
  };

  const register = async (email: string, password: string, displayName?: string) => {
    logger.info('AuthContext', 'Registration initiated', { email, displayName });
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
      logger.info('AuthContext', 'Registration successful - connecting services');
      socketManager.connect().catch((err) => logger.error('AuthContext', 'Socket connection error', err));
      registerForPushNotifications().catch((err) => logger.error('AuthContext', 'Push registration error', err));
    } catch (err: any) {
      const errorMessage = err.message || 'Registration failed';
      logger.error('AuthContext', 'Registration failed', { error: errorMessage });
      dispatch({ type: 'AUTH_FAILURE', payload: errorMessage });
      throw err;
    }
  };

  const logout = async () => {
    logger.info('AuthContext', 'Logout initiated');
    try {
      await authApi.logout();
    } catch (e) {
      // Ignore logout API errors
      logger.error('AuthContext', 'Logout API error', e);
    }
    await clearTokens();
    socketManager.disconnect();
    dispatch({ type: 'LOGOUT' });
    logger.info('AuthContext', 'Logout complete');
  };

  const clearError = () => {
    logger.debug('AuthContext', 'Clearing error');
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
    logger.error('AuthContext', 'useAuth called outside of AuthProvider');
    throw new Error('useAuth must be used within an AuthProvider');
  }
  logger.debug('AuthContext', 'useAuth called', { isAuthenticated: context.isAuthenticated });
  return context;
}
