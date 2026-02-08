// =============================================================================
// Settings Screen
// =============================================================================
// App settings, user info, connection status, and integrations.

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../features/auth/AuthContext';
import { colors } from '../theme/colors';
import { socketManager } from '../services/websocket';
import { RootStackParamList } from '../navigation/types';
import { DEMO_MODE, API_URL } from '../config';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// Settings Row Component
// =============================================================================

interface SettingsRowProps {
  label: string;
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress?: () => void;
  isDestructive?: boolean;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
}

function SettingsRow({
  label,
  value,
  icon,
  iconColor,
  onPress,
  isDestructive,
  showChevron,
  rightElement,
}: SettingsRowProps) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {icon && (
          <View style={[styles.iconContainer, { backgroundColor: `${iconColor || colors.primary}20` }]}>
            <Ionicons name={icon} size={18} color={iconColor || colors.primary} />
          </View>
        )}
        <Text
          style={[
            styles.rowLabel,
            isDestructive && styles.rowLabelDestructive,
          ]}
        >
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        {rightElement}
        {showChevron && (
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.rowPressed]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

// =============================================================================
// Settings Section Component
// =============================================================================

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

// =============================================================================
// Connection Status Badge
// =============================================================================

function ConnectionStatusBadge({ isConnected }: { isConnected: boolean }) {
  return (
    <View style={[styles.statusBadge, isConnected ? styles.statusConnected : styles.statusDisconnected]}>
      <View style={[styles.statusDot, isConnected ? styles.dotConnected : styles.dotDisconnected]} />
      <Text style={[styles.statusText, isConnected ? styles.textConnected : styles.textDisconnected]}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </Text>
    </View>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const { user, logout } = useAuth();

  const [isSocketConnected, setIsSocketConnected] = useState(false);

  useEffect(() => {
    // Check socket connection status
    const checkConnection = () => {
      setIsSocketConnected(socketManager.isConnected());
    };

    checkConnection();
    const interval = setInterval(checkConnection, 2000);

    return () => clearInterval(interval);
  }, []);

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

  const handleNavigateToIntegrations = () => {
    navigation.navigate('Integrations');
  };

  const handleNavigateToSecrets = () => {
    navigation.navigate('SecretManagement');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={styles.header}>Settings</Text>

      {/* Demo Mode Banner */}
      {DEMO_MODE && (
        <View style={styles.demoBanner}>
          <Ionicons name="flask" size={20} color={colors.warning} />
          <View style={styles.demoBannerTextContainer}>
            <Text style={styles.demoBannerTitle}>Demo Mode Active</Text>
            <Text style={styles.demoBannerText}>
              Running with mock responses. Set EXPO_PUBLIC_DEMO_MODE=false to connect to backend.
            </Text>
          </View>
        </View>
      )}

      {/* User Account Section */}
      <SettingsSection title="Account">
        <SettingsRow
          label="Email"
          value={user?.email || 'Not signed in'}
          icon="mail"
          iconColor={colors.info}
        />
        <SettingsRow
          label="Display Name"
          value={user?.displayName || 'Not set'}
          icon="person"
          iconColor={colors.success}
        />
        <SettingsRow
          label="Log Out"
          icon="log-out"
          iconColor={colors.error}
          onPress={handleLogout}
          isDestructive
        />
      </SettingsSection>

      {/* Connection Status Section */}
      <SettingsSection title="Connection">
        <SettingsRow
          label="Server"
          value={DEMO_MODE ? 'Demo (Offline)' : API_URL.replace('https://', '').replace('http://', '')}
          icon="server"
          iconColor={colors.primary}
        />
        <SettingsRow
          label="WebSocket"
          icon="wifi"
          iconColor={isSocketConnected ? colors.success : colors.error}
          rightElement={<ConnectionStatusBadge isConnected={isSocketConnected || DEMO_MODE} />}
        />
      </SettingsSection>

      {/* Integrations Section */}
      <SettingsSection title="Integrations">
        <SettingsRow
          label="Connected Apps"
          icon="apps"
          iconColor={colors.accent}
          onPress={handleNavigateToIntegrations}
          showChevron
        />
        <SettingsRow
          label="API Keys & Secrets"
          icon="key"
          iconColor={colors.warning}
          onPress={handleNavigateToSecrets}
          showChevron
        />
      </SettingsSection>

      {/* About Section */}
      <SettingsSection title="About">
        <SettingsRow
          label="App Name"
          value="Project Jarvis"
          icon="hardware-chip"
          iconColor={colors.primary}
        />
        <SettingsRow
          label="Version"
          value="0.1.0"
          icon="pricetag"
          iconColor={colors.textSecondary}
        />
        <SettingsRow
          label="Mode"
          value={DEMO_MODE ? 'Demo' : 'Production'}
          icon="settings"
          iconColor={colors.textSecondary}
        />
      </SettingsSection>

      {/* Development Section */}
      <SettingsSection title="Technical">
        <SettingsRow
          label="Architecture"
          value="Hexagonal"
          icon="cube"
          iconColor={colors.agentCoding}
        />
        <SettingsRow
          label="State"
          value="React Context"
          icon="git-branch"
          iconColor={colors.agentResearch}
        />
        <SettingsRow
          label="Navigation"
          value="React Nav 7"
          icon="navigate"
          iconColor={colors.info}
        />
      </SettingsSection>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerLogoContainer}>
          <Ionicons name="hardware-chip" size={24} color={colors.primary} />
        </View>
        <Text style={styles.footerText}>Project Jarvis</Text>
        <Text style={styles.footerSubtext}>Built with React Native + Expo</Text>
      </View>
    </ScrollView>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 24,
    marginLeft: 4,
  },
  demoBanner: {
    flexDirection: 'row',
    backgroundColor: `${colors.warning}15`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: `${colors.warning}30`,
    gap: 12,
  },
  demoBannerTextContainer: {
    flex: 1,
  },
  demoBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.warning,
  },
  demoBannerText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionContent: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.backgroundTertiary,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
  },
  rowLabelDestructive: {
    color: colors.error,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValue: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  statusConnected: {
    backgroundColor: `${colors.success}20`,
  },
  statusDisconnected: {
    backgroundColor: `${colors.error}20`,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: colors.success,
  },
  dotDisconnected: {
    backgroundColor: colors.error,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  textConnected: {
    color: colors.success,
  },
  textDisconnected: {
    color: colors.error,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 24,
  },
  footerLogoContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  footerSubtext: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
});
