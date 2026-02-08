import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar as RNStatusBar, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './features/auth/AuthContext';
import { TaskObservabilityProvider } from './features/observability/TaskObservabilityContext';
import { RootNavigator } from './navigation/RootNavigator';
import { colors } from './theme';
import { setupPushNotificationListeners } from './services/pushNotifications';

export default function AppContainer() {
  // Setup push notification listeners on mount
  useEffect(() => {
    const cleanup = setupPushNotificationListeners();
    return cleanup;
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <View style={styles.container}>
          <RNStatusBar barStyle="light-content" backgroundColor={colors.background} />
          <AuthProvider>
            <TaskObservabilityProvider>
              <RootNavigator />
            </TaskObservabilityProvider>
          </AuthProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
