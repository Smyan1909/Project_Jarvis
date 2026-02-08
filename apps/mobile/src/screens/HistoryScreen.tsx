// =============================================================================
// History Screen
// =============================================================================
// View conversation history with messages from all past runs.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { orchestratorApi } from '../services/api';
import { RootStackParamList } from '../navigation/types';
import { DEMO_MODE } from '../config';

type HistoryScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// =============================================================================
// Types
// =============================================================================

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: unknown;
  createdAt: string;
}

// =============================================================================
// Demo Data
// =============================================================================

const DEMO_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'Create a PR for the new login feature',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: '2',
    role: 'assistant',
    content: 'I\'ve created PR #42 for the new login feature. The PR includes:\n- User authentication with email/password\n- Session management\n- Remember me functionality',
    createdAt: new Date(Date.now() - 3500000).toISOString(),
  },
  {
    id: '3',
    role: 'user',
    content: 'Schedule a team meeting for tomorrow at 2pm',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: '4',
    role: 'assistant',
    content: 'I\'ve scheduled a team meeting for tomorrow at 2:00 PM. I\'ve sent calendar invites to all team members.',
    createdAt: new Date(Date.now() - 7100000).toISOString(),
  },
  {
    id: '5',
    role: 'user',
    content: 'What\'s the status of the backend deployment?',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: '6',
    role: 'assistant',
    content: 'The backend deployment is currently in progress. All tests have passed and the build is being pushed to production. ETA: 5 minutes.',
    createdAt: new Date(Date.now() - 86300000).toISOString(),
  },
];

// =============================================================================
// Message Item
// =============================================================================

function MessageItem({
  message,
  onDelete,
}: {
  message: Message;
  onDelete: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  const formattedDate = new Date(message.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.messageContainer, isUser ? styles.userMessage : styles.assistantMessage]}>
      <View style={styles.messageHeader}>
        <View style={styles.roleContainer}>
          <Ionicons
            name={isUser ? 'person' : 'hardware-chip'}
            size={16}
            color={isUser ? colors.userBubble : colors.primary}
          />
          <Text style={[styles.roleText, isUser && styles.userRoleText]}>
            {isUser ? 'You' : 'Jarvis'}
          </Text>
        </View>
        <View style={styles.messageActions}>
          <Text style={styles.dateText}>{formattedDate}</Text>
          {!DEMO_MODE && (
            <TouchableOpacity
              onPress={() => onDelete(message.id)}
              style={styles.deleteButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={styles.messageContent}>{message.content}</Text>
    </View>
  );
}

// =============================================================================
// Component
// =============================================================================

export function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<HistoryScreenNavigationProp>();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (DEMO_MODE) {
      setMessages(DEMO_MESSAGES);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await orchestratorApi.getHistory(50);
      setMessages(data.messages);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchHistory();
  }, [fetchHistory]);

  const handleDelete = useCallback(async (messageId: string) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await orchestratorApi.deleteMessage(messageId);
              setMessages((prev) => prev.filter((m) => m.id !== messageId));
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete message');
            }
          },
        },
      ]
    );
  }, []);

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear all conversation history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            if (DEMO_MODE) {
              setMessages([]);
              return;
            }
            try {
              await orchestratorApi.clearHistory();
              setMessages([]);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to clear history');
            }
          },
        },
      ]
    );
  }, []);

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="chatbubbles-outline" size={64} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No Conversation History</Text>
      <Text style={styles.emptySubtitle}>
        Your conversations with Jarvis will appear here.
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Ionicons name="cloud-offline-outline" size={64} color={colors.error} />
      <Text style={styles.errorTitle}>Failed to Load History</Text>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>History</Text>
        {messages.length > 0 && (
          <TouchableOpacity
            onPress={handleClearHistory}
            style={styles.clearButton}
          >
            <Ionicons name="trash-bin-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      ) : error ? (
        renderError()
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageItem message={item} onDelete={handleDelete} />
          )}
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  clearButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: `${colors.error}15`,
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
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  messageContainer: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userMessage: {
    borderLeftWidth: 3,
    borderLeftColor: colors.userBubble,
  },
  assistantMessage: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  userRoleText: {
    color: colors.userBubble,
  },
  messageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  deleteButton: {
    padding: 4,
  },
  messageContent: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
