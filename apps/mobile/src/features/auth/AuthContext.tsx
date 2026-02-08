import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { authApi, setTokens, clearTokens, getAccessToken } from '../../services/api';
import { DEMO_MODE } from '../../config';

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
      // Bypass authentication in demo mode
      if (DEMO_MODE) {
        dispatch({ type: 'AUTH_SUCCESS', payload: { email: 'demo@jarvis.local' } });
        return;
      }

      try {
        const token = await getAccessToken();
        dispatch({ type: 'RESTORE_TOKEN', payload: !!token });
      } catch (err) {
        console.error('Error checking token:', err);
        dispatch({ type: 'RESTORE_TOKEN', payload: false });
      }
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
      const errorMessage = err.message || 'Login failed';
      dispatch({ type: 'AUTH_FAILURE', payload: errorMessage });
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
