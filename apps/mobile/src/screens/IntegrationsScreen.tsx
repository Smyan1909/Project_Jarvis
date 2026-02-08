// =============================================================================
// Integrations Screen
// =============================================================================
// Manage OAuth connections to external services (GitHub, Slack, etc.)

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useAuth } from '../features/auth/AuthContext';
import { useIntegrations } from '../hooks/useIntegrations';
import { IntegrationCard } from '../components/IntegrationCard';
import { RootStackParamList } from '../navigation/types';
import { DEMO_MODE } from '../config';

type IntegrationsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Integrations'>;

// =============================================================================
// Demo Mode Data
// =============================================================================

const DEMO_APPS = [
  {
    key: 'github',
    slug: 'github',
    name: 'GitHub',
    description: 'Code hosting and version control',
    isConnected: true,
    connectedAccountId: 'demo-github-account',
  },
  {
    key: 'slack',
    slug: 'slack',
    name: 'Slack',
    description: 'Team communication and messaging',
    isConnected: false,
  },
  {
    key: 'google-calendar',
    slug: 'calendar',
    name: 'Google Calendar',
    description: 'Schedule and event management',
    isConnected: false,
  },
  {
    key: 'gmail',
    slug: 'gmail',
    name: 'Gmail',
    description: 'Email reading and sending',
    isConnected: true,
    connectedAccountId: 'demo-gmail-account',
  },
  {
    key: 'notion',
    slug: 'notion',
    name: 'Notion',
    description: 'Notes and documentation',
    isConnected: false,
  },
  {
    key: 'linear',
    slug: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project management',
    isConnected: false,
  },
];

// =============================================================================
// Component
// =============================================================================

export function IntegrationsScreen() {
  const navigation = useNavigation<IntegrationsScreenNavigationProp>();
  const { user } = useAuth();
  const userId = user?.id || 'demo-user';

  const {
    apps,
    isLoading,
    isRefreshing,
    error,
    pendingAppKey,
    refreshApps,
    initiateConnection,
    disconnectApp,
    cancelPendingConnection,
  } = useIntegrations({ userId });

  // Use demo data in demo mode
  const displayApps = DEMO_MODE ? DEMO_APPS : apps;

  const handleConnect = useCallback(
    async (appKey: string) => {
      if (DEMO_MODE) {
        Alert.alert(
          'Demo Mode',
          'OAuth connections are disabled in demo mode. Connect to a real backend to enable integrations.',
          [{ text: 'OK' }]
        );
        return;
      }
      await initiateConnection(appKey);
    },
    [initiateConnection]
  );

  const handleDisconnect = useCallback(
    async (accountId: string, appKey: string, appName: string) => {
      if (DEMO_MODE) {
        Alert.alert(
          'Demo Mode',
          'OAuth connections are disabled in demo mode.',
          [{ text: 'OK' }]
        );
        return;
      }

      Alert.alert(
        'Disconnect Integration',
        `Are you sure you want to disconnect ${appName}? Jarvis will no longer be able to access your ${appName} data.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: () => disconnectApp(accountId, appKey),
          },
        ]
      );
    },
    [disconnectApp]
  );

  const handleRefresh = useCallback(() => {
    if (!DEMO_MODE) {
      refreshApps();
    }
  }, [refreshApps]);

  const connectedCount = displayApps.filter((app) => app.isConnected).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Integrations</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={20} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={cancelPendingConnection}>
            <Ionicons name="close-circle" size={20} color={colors.error} />
          </TouchableOpacity>
        </View>
      )}

      {/* Pending Connection Banner */}
      {pendingAppKey && (
        <View style={styles.pendingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.pendingText}>
            Waiting for {pendingAppKey} authorization...
          </Text>
          <TouchableOpacity onPress={cancelPendingConnection}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading integrations...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryIconContainer}>
              <Ionicons name="apps" size={32} color={colors.primary} />
            </View>
            <View style={styles.summaryTextContainer}>
              <Text style={styles.summaryTitle}>Connected Services</Text>
              <Text style={styles.summarySubtitle}>
                {connectedCount} of {displayApps.length} integrations active
              </Text>
            </View>
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={colors.info} />
            <Text style={styles.infoText}>
              Connect your apps to let Jarvis help with tasks across different services.
              Your credentials are securely stored and encrypted.
            </Text>
          </View>

          {/* Demo Mode Notice */}
          {DEMO_MODE && (
            <View style={styles.demoNotice}>
              <Ionicons name="flask" size={20} color={colors.warning} />
              <Text style={styles.demoNoticeText}>
                Demo mode: Integration changes are simulated.
              </Text>
            </View>
          )}

          {/* Integrations List */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Integrations</Text>
          </View>

          {displayApps.map((app) => (
            <IntegrationCard
              key={app.key}
              app={app}
              onConnect={() => handleConnect(app.key)}
              onDisconnect={() =>
                handleDisconnect(app.connectedAccountId || '', app.key, app.name)
              }
              isLoading={pendingAppKey === app.key}
              disabled={!!pendingAppKey && pendingAppKey !== app.key}
            />
          ))}

          {/* Coming Soon Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Coming Soon</Text>
          </View>

          <View style={styles.comingSoonCard}>
            <View style={styles.comingSoonRow}>
              <View style={styles.comingSoonIconContainer}>
                <Ionicons name="logo-discord" size={24} color={colors.textTertiary} />
              </View>
              <Text style={styles.comingSoonText}>Discord</Text>
            </View>
            <View style={styles.comingSoonRow}>
              <View style={styles.comingSoonIconContainer}>
                <Ionicons name="logo-twitter" size={24} color={colors.textTertiary} />
              </View>
              <Text style={styles.comingSoonText}>Twitter</Text>
            </View>
            <View style={styles.comingSoonRow}>
              <View style={styles.comingSoonIconContainer}>
                <Ionicons name="cloud-outline" size={24} color={colors.textTertiary} />
              </View>
              <Text style={styles.comingSoonText}>Dropbox</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 4,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  headerRight: {
    width: 40,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.error}15`,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.error,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pendingText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  summaryIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${colors.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  summaryTextContainer: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  summarySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: `${colors.info}10`,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: `${colors.info}30`,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  demoNotice: {
    flexDirection: 'row',
    backgroundColor: `${colors.warning}10`,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: `${colors.warning}30`,
  },
  demoNoticeText: {
    flex: 1,
    fontSize: 13,
    color: colors.warning,
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  comingSoonCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  comingSoonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  comingSoonIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comingSoonText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
});
