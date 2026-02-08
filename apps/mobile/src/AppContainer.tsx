import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar as RNStatusBar, View, StyleSheet } from 'react-native';
import { AuthProvider } from './features/auth/AuthContext';
import { RootNavigator } from './navigation/RootNavigator';
import { theme } from './theme';

export default function AppContainer() {
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <RNStatusBar barStyle="dark-content" backgroundColor={theme.colors.background} />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
