// =============================================================================
// Push Notifications Service
// =============================================================================
// Handles Expo push notification registration, permissions, and listeners.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { monitoringApi } from './api';
import { DEMO_MODE } from '../config';

// =============================================================================
// Configuration
// =============================================================================

// Configure how notifications are handled when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// =============================================================================
// Registration
// =============================================================================

/**
 * Request push notification permissions and register token with backend.
 * Returns the Expo push token if successful, null otherwise.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Skip in demo mode
  if (DEMO_MODE) {
    console.log('[Push] Skipping registration in demo mode');
    return null;
  }

  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('[Push] Push notifications require a physical device');
    return null;
  }

  try {
    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted');
      return null;
    }

    // Get project ID from config
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      process.env.EXPO_PUBLIC_PROJECT_ID;

    if (!projectId) {
      console.warn('[Push] No Expo project ID configured');
      return null;
    }

    // Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    console.log('[Push] Token obtained:', token.substring(0, 30) + '...');

    // Register with backend
    const platform = Platform.OS as 'ios' | 'android';
    try {
      await monitoringApi.registerPushToken(token, platform);
      console.log('[Push] Token registered with backend');
    } catch (error) {
      console.error('[Push] Failed to register token with backend:', error);
      // Still return the token - it was obtained successfully
    }

    // Configure Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00D9FF',
      });
    }

    return token;
  } catch (error) {
    console.error('[Push] Registration failed:', error);
    return null;
  }
}

// =============================================================================
// Listeners
// =============================================================================

/**
 * Setup push notification listeners.
 * Returns a cleanup function to remove listeners.
 */
export function setupPushNotificationListeners(): () => void {
  // Handle notifications received while app is foregrounded
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log('[Push] Notification received:', notification.request.content.title);
    // Could dispatch to a global state here if needed
  });

  // Handle notification taps (when user interacts with notification)
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('[Push] Notification tapped:', response.notification.request.content.data);
    
    const data = response.notification.request.content.data;
    
    // Handle different notification types
    if (data?.type === 'orchestrator_complete') {
      // Could navigate to a specific screen
      console.log('[Push] Task completed, runId:', data.runId);
    } else if (data?.type === 'monitoring_event') {
      // Could navigate to monitoring events
      console.log('[Push] Monitoring event:', data.eventId);
    }
  });

  // Return cleanup function
  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the current push notification permission status.
 */
export async function getNotificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Clear all displayed notifications.
 */
export async function clearAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
}

/**
 * Get the badge count (iOS only).
 */
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

/**
 * Set the badge count (iOS only).
 */
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}
