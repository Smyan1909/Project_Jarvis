// =============================================================================
// useIntegrations Hook
// =============================================================================
// Manages OAuth integrations with polling for connection status.

import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

// Declare window for web platform
declare const window: {
  innerWidth: number;
  innerHeight: number;
  open: (url: string, target: string, features: string) => void;
} | undefined;
import { composioApi, AppWithStatus, ConnectionStatus } from '../services/api';

// =============================================================================
// Types
// =============================================================================

interface UseIntegrationsOptions {
  userId: string;
  callbackUrl?: string;
}

interface UseIntegrationsState {
  apps: AppWithStatus[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  pendingConnectionId: string | null;
  pendingAppKey: string | null;
}

interface UseIntegrationsReturn extends UseIntegrationsState {
  refreshApps: () => Promise<void>;
  initiateConnection: (appKey: string) => Promise<void>;
  disconnectApp: (accountId: string, appKey: string) => Promise<void>;
  cancelPendingConnection: () => void;
  confirmManualAuthorization: () => Promise<void>;
}

// =============================================================================
// Constants
// =============================================================================

const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 60; // 2 minutes max polling

// =============================================================================
// Hook
// =============================================================================

export function useIntegrations({ userId, callbackUrl }: UseIntegrationsOptions): UseIntegrationsReturn {
  const [state, setState] = useState<UseIntegrationsState>({
    apps: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    pendingConnectionId: null,
    pendingAppKey: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollAttemptsRef = useRef(0);

  // Generate callback URL for OAuth redirect
  const getCallbackUrl = useCallback(() => {
    if (callbackUrl) return callbackUrl;
    // Use Expo deep linking
    return Linking.createURL('oauth/callback');
  }, [callbackUrl]);

  // Fetch apps with connection status
  const fetchApps = useCallback(async () => {
    try {
      const { apps } = await composioApi.getApps(userId);
      console.log('[Integrations] Fetched apps:', apps);
      
      // Log connected apps specifically
      const connected = apps.filter(a => a.isConnected);
      console.log('[Integrations] Connected apps:', connected);
      
      setState((prev) => ({
        ...prev,
        apps,
        error: null,
      }));
    } catch (error: any) {
      console.error('[Integrations] Failed to fetch apps:', error);
      setState((prev) => ({
        ...prev,
        error: error.message || 'Failed to fetch integrations',
      }));
    }
  }, [userId]);

  // Initial load
  useEffect(() => {
    async function load() {
      setState((prev) => ({ ...prev, isLoading: true }));
      await fetchApps();
      setState((prev) => ({ ...prev, isLoading: false }));
    }
    load();
  }, [fetchApps]);

  // Refresh apps
  const refreshApps = useCallback(async () => {
    setState((prev) => ({ ...prev, isRefreshing: true }));
    await fetchApps();
    setState((prev) => ({ ...prev, isRefreshing: false }));
  }, [fetchApps]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollAttemptsRef.current = 0;
  }, []);

  // Poll connection status
  const pollConnectionStatus = useCallback(
    async (connectionId: string, appKey: string) => {
      pollAttemptsRef.current++;

      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        stopPolling();
        setState((prev) => ({
          ...prev,
          pendingConnectionId: null,
          pendingAppKey: null,
          error: 'Connection timed out. Please try again.',
        }));
        return;
      }

      try {
        const status: ConnectionStatus = await composioApi.getConnectionStatus(connectionId);

        // Debug logging for OAuth polling
        console.log('[OAuth] Poll response for', connectionId, ':', status);

        if (status.status === 'active') {
          // Connection successful
          console.log('[OAuth] Connection successful! Stopping polling and refreshing apps...');
          stopPolling();
          setState((prev) => ({
            ...prev,
            pendingConnectionId: null,
            pendingAppKey: null,
          }));
          
          // Refresh the backend Composio session to pick up the new connection
          try {
            console.log('[OAuth] Refreshing backend Composio session...');
            await composioApi.refreshSession(userId);
            console.log('[OAuth] Backend session refreshed successfully');
          } catch (error) {
            console.error('[OAuth] Failed to refresh backend session:', error);
            // Continue anyway - the session will be refreshed lazily on next use
          }
          
          // Refresh apps to get updated status
          await fetchApps();
          console.log('[OAuth] Apps refreshed after successful connection');
        }
        // If still 'initiated', continue polling
      } catch (error: any) {
        // Don't stop polling on network errors, just log
        console.error('Error polling connection status:', error);
      }
    },
    [fetchApps, stopPolling, userId]
  );

  // Start polling for connection status
  const startPolling = useCallback(
    (connectionId: string, appKey: string) => {
      stopPolling();
      pollIntervalRef.current = setInterval(() => {
        pollConnectionStatus(connectionId, appKey);
      }, POLL_INTERVAL);
    },
    [pollConnectionStatus, stopPolling]
  );

  // Initiate OAuth connection
  const initiateConnection = useCallback(
    async (appKey: string) => {
      setState((prev) => ({ ...prev, error: null }));

      try {
        const connectionInfo = await composioApi.initiateConnection(
          userId,
          appKey,
          getCallbackUrl()
        );

        setState((prev) => ({
          ...prev,
          pendingConnectionId: connectionInfo.connectionId,
          pendingAppKey: appKey,
        }));

        // Open OAuth URL - use popup on web for better UX
        if (Platform.OS === 'web' && window) {
          // Open in a popup window
          const popupWidth = 600;
          const popupHeight = 700;
          const left = (window.innerWidth - popupWidth) / 2;
          const top = (window.innerHeight - popupHeight) / 2;
          window.open(
            connectionInfo.redirectUrl,
            'oauth_popup',
            `width=${popupWidth},height=${popupHeight},left=${left},top=${top},popup=1`
          );
        } else {
          await Linking.openURL(connectionInfo.redirectUrl);
        }

        // Start polling for status
        startPolling(connectionInfo.connectionId, appKey);
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          error: error.message || `Failed to connect to ${appKey}`,
        }));
      }
    },
    [userId, getCallbackUrl, startPolling]
  );

  // Disconnect app
  const disconnectApp = useCallback(
    async (accountId: string, appKey: string) => {
      setState((prev) => ({ ...prev, error: null }));

      try {
        await composioApi.disconnectAccount(accountId);
        // Refresh apps to get updated status
        await fetchApps();
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          error: error.message || `Failed to disconnect ${appKey}`,
        }));
      }
    },
    [fetchApps]
  );

  // Cancel pending connection
  const cancelPendingConnection = useCallback(() => {
    stopPolling();
    setState((prev) => ({
      ...prev,
      pendingConnectionId: null,
      pendingAppKey: null,
    }));
  }, [stopPolling]);

  // Manually confirm authorization (for when redirect doesn't work)
  const confirmManualAuthorization = useCallback(async () => {
    if (state.pendingConnectionId && state.pendingAppKey) {
      // Poll immediately to check if authorization completed
      await pollConnectionStatus(state.pendingConnectionId, state.pendingAppKey);
    }
  }, [state.pendingConnectionId, state.pendingAppKey, pollConnectionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Listen for deep link callback
  useEffect(() => {
    const subscription = Linking.addEventListener('url', async (event) => {
      const url = event.url;
      if (url.includes('oauth/callback')) {
        // OAuth completed, poll immediately
        if (state.pendingConnectionId && state.pendingAppKey) {
          await pollConnectionStatus(state.pendingConnectionId, state.pendingAppKey);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [state.pendingConnectionId, state.pendingAppKey, pollConnectionStatus]);

  return {
    ...state,
    refreshApps,
    initiateConnection,
    disconnectApp,
    cancelPendingConnection,
    confirmManualAuthorization,
  };
}
