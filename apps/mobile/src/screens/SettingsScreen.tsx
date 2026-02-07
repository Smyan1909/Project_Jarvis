import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../features/auth/AuthContext';
import { theme } from '../theme';
import { DEMO_MODE } from '../config';

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  isDestructive?: boolean;
}

function SettingsRow({ label, value, onPress, isDestructive }: SettingsRowProps) {
  const content = (
    <View style={styles.row}>
      <Text
        style={[
          styles.rowLabel,
          isDestructive ? styles.rowLabelDestructive : undefined,
        ]}
      >
        {label}
      </Text>
      {value && <Text style={styles.rowValue}>{value}</Text>}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed ? styles.rowPressed : undefined]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.lg },
      ]}
    >
      {/* Header */}
      <Text style={styles.header}>Settings</Text>

      {/* Demo Mode Banner */}
      {DEMO_MODE && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerTitle}>Demo Mode Active</Text>
          <Text style={styles.demoBannerText}>
            The app is running with mock responses. To connect to a real backend,
            set DEMO_MODE to false in config.ts
          </Text>
        </View>
      )}

      {/* Account Section */}
      <SettingsSection title="Account">
        <SettingsRow
          label="Email"
          value={user?.email || 'Not signed in'}
        />
        <SettingsRow
          label="Log Out"
          onPress={handleLogout}
          isDestructive
        />
      </SettingsSection>

      {/* About Section */}
      <SettingsSection title="About">
        <SettingsRow label="App Name" value="Project Jarvis" />
        <SettingsRow label="Version" value="0.1.0" />
        <SettingsRow label="Expo SDK" value="54" />
        <SettingsRow
          label="Mode"
          value={DEMO_MODE ? 'Demo (Offline)' : 'Production'}
        />
      </SettingsSection>

      {/* Development Section */}
      <SettingsSection title="Development">
        <SettingsRow
          label="Architecture"
          value="Hexagonal"
        />
        <SettingsRow
          label="State Management"
          value="React Context"
        />
        <SettingsRow
          label="Navigation"
          value="React Navigation 7"
        />
      </SettingsSection>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Built with React Native + Expo
        </Text>
        <Text style={styles.footerText}>
          Project Jarvis
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  content: {
    paddingHorizontal: theme.spacing.md,
  },
  header: {
    ...theme.typography.h1,
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  demoBanner: {
    backgroundColor: theme.colors.warning,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  demoBannerTitle: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
    marginBottom: theme.spacing.xs,
  },
  demoBannerText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textInverse,
    opacity: 0.9,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    ...theme.typography.caption,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.sm,
    marginLeft: theme.spacing.md,
  },
  sectionContent: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  rowPressed: {
    backgroundColor: theme.colors.backgroundSecondary,
  },
  rowLabel: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
  rowLabelDestructive: {
    color: theme.colors.error,
  },
  rowValue: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
  },
  footer: {
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
  },
  footerText: {
    ...theme.typography.caption,
    color: theme.colors.textTertiary,
    marginBottom: theme.spacing.xs,
  },
});
