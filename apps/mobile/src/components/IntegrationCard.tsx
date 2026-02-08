// =============================================================================
// Integration Card
// =============================================================================
// Displays a single integration app with connection status and actions.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { AppWithStatus } from '../services/api';

// =============================================================================
// App Icon Mapping
// =============================================================================

function getAppIcon(slug: string): keyof typeof Ionicons.glyphMap {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    github: 'logo-github',
    slack: 'logo-slack',
    google: 'logo-google',
    gmail: 'mail-outline',
    calendar: 'calendar-outline',
    notion: 'document-text-outline',
    linear: 'git-branch-outline',
    jira: 'ticket-outline',
    trello: 'layers-outline',
    discord: 'logo-discord',
    dropbox: 'cloud-outline',
    drive: 'folder-outline',
    zoom: 'videocam-outline',
    teams: 'people-outline',
    twitter: 'logo-twitter',
    linkedin: 'logo-linkedin',
  };
  return iconMap[slug.toLowerCase()] || 'apps-outline';
}

function getAppColor(slug: string): string {
  const colorMap: Record<string, string> = {
    github: '#8B5CF6',
    slack: '#4A154B',
    google: '#4285F4',
    gmail: '#EA4335',
    calendar: '#0F9D58',
    notion: '#FFFFFF',
    linear: '#5E6AD2',
    jira: '#0052CC',
    trello: '#0079BF',
    discord: '#5865F2',
    dropbox: '#0061FF',
    drive: '#4285F4',
    zoom: '#2D8CFF',
    teams: '#6264A7',
    twitter: '#1DA1F2',
    linkedin: '#0A66C2',
  };
  return colorMap[slug.toLowerCase()] || colors.primary;
}

// =============================================================================
// Props
// =============================================================================

interface IntegrationCardProps {
  app: AppWithStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function IntegrationCard({
  app,
  onConnect,
  onDisconnect,
  isLoading = false,
  disabled = false,
}: IntegrationCardProps) {
  const appIcon = getAppIcon(app.slug);
  const appColor = getAppColor(app.slug);

  return (
    <View style={styles.container}>
      {/* App Icon */}
      <View style={[styles.iconContainer, { backgroundColor: `${appColor}20` }]}>
        <Ionicons name={appIcon} size={28} color={appColor} />
      </View>

      {/* App Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.appName}>{app.name}</Text>
        {app.description && (
          <Text style={styles.appDescription} numberOfLines={1}>
            {app.description}
          </Text>
        )}
        {app.isConnected && (
          <View style={styles.connectedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        )}
      </View>

      {/* Action Button */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          app.isConnected ? styles.disconnectButton : styles.connectButton,
          (isLoading || disabled) && styles.buttonDisabled,
        ]}
        onPress={app.isConnected ? onDisconnect : onConnect}
        disabled={isLoading || disabled}
        activeOpacity={0.7}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={app.isConnected ? colors.error : colors.textInverse} />
        ) : (
          <>
            <Ionicons
              name={app.isConnected ? 'unlink-outline' : 'link-outline'}
              size={16}
              color={app.isConnected ? colors.error : colors.textInverse}
            />
            <Text
              style={[
                styles.actionText,
                app.isConnected ? styles.disconnectText : styles.connectText,
              ]}
            >
              {app.isConnected ? 'Disconnect' : 'Connect'}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  infoContainer: {
    flex: 1,
    marginRight: 12,
  },
  appName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  appDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  connectedText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.success,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    minWidth: 100,
  },
  connectButton: {
    backgroundColor: colors.primary,
  },
  disconnectButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  connectText: {
    color: colors.textInverse,
  },
  disconnectText: {
    color: colors.error,
  },
});
