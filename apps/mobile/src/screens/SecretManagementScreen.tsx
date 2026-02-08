// =============================================================================
// Secret Management Screen
// =============================================================================
// CRUD operations for API keys and secrets.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { secretsApi } from '../services/api';
import { RootStackParamList } from '../navigation/types';
import { DEMO_MODE } from '../config';

type SecretManagementScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SecretManagement'>;

// =============================================================================
// Types
// =============================================================================

interface Secret {
  id: string;
  provider: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Demo Data
// =============================================================================

const DEMO_SECRETS: Secret[] = [
  {
    id: '1',
    provider: 'openai',
    name: 'OpenAI API Key',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: '2',
    provider: 'anthropic',
    name: 'Anthropic API Key',
    createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

// =============================================================================
// Provider Info
// =============================================================================

const PROVIDERS = [
  { key: 'openai', name: 'OpenAI', icon: 'sparkles' as const, color: '#00A67E' },
  { key: 'anthropic', name: 'Anthropic', icon: 'cube' as const, color: '#D97757' },
  { key: 'google', name: 'Google AI', icon: 'logo-google' as const, color: '#4285F4' },
  { key: 'github', name: 'GitHub', icon: 'logo-github' as const, color: '#8B5CF6' },
  { key: 'custom', name: 'Custom', icon: 'key' as const, color: colors.textSecondary },
];

function getProviderInfo(provider: string) {
  return PROVIDERS.find((p) => p.key === provider) || PROVIDERS[PROVIDERS.length - 1];
}

// =============================================================================
// Secret Card Component
// =============================================================================

function SecretCard({
  secret,
  onEdit,
  onDelete,
}: {
  secret: Secret;
  onEdit: (secret: Secret) => void;
  onDelete: (id: string) => void;
}) {
  const providerInfo = getProviderInfo(secret.provider);
  const formattedDate = new Date(secret.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <View style={styles.secretCard}>
      <View style={[styles.secretIcon, { backgroundColor: `${providerInfo.color}20` }]}>
        <Ionicons name={providerInfo.icon} size={24} color={providerInfo.color} />
      </View>
      <View style={styles.secretInfo}>
        <Text style={styles.secretName}>{secret.name}</Text>
        <Text style={styles.secretProvider}>{providerInfo.name}</Text>
        <Text style={styles.secretDate}>Updated {formattedDate}</Text>
      </View>
      <View style={styles.secretActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onEdit(secret)}
        >
          <Ionicons name="pencil" size={18} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => onDelete(secret.id)}
        >
          <Ionicons name="trash" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// =============================================================================
// Add/Edit Modal
// =============================================================================

interface SecretModalProps {
  visible: boolean;
  secret: Secret | null;
  onClose: () => void;
  onSave: (provider: string, name: string, value: string) => Promise<void>;
}

function SecretModal({ visible, secret, onClose, onSave }: SecretModalProps) {
  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!secret;

  useEffect(() => {
    if (secret) {
      setProvider(secret.provider);
      setName(secret.name);
      setValue(''); // Don't show existing value
    } else {
      setProvider('openai');
      setName('');
      setValue('');
    }
    setError(null);
  }, [secret, visible]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!value.trim() && !isEditing) {
      setError('Secret value is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(provider, name.trim(), value.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save secret');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} disabled={isSaving}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {isEditing ? 'Edit Secret' : 'Add Secret'}
          </Text>
          <TouchableOpacity onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.modalSaveText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          {/* Error */}
          {error && (
            <View style={styles.modalError}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={styles.modalErrorText}>{error}</Text>
            </View>
          )}

          {/* Provider Selector */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Provider</Text>
            <View style={styles.providerGrid}>
              {PROVIDERS.slice(0, -1).map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.providerButton,
                    provider === p.key && styles.providerButtonActive,
                    provider === p.key && { borderColor: p.color },
                  ]}
                  onPress={() => setProvider(p.key)}
                  disabled={isEditing}
                >
                  <Ionicons
                    name={p.icon}
                    size={20}
                    color={provider === p.key ? p.color : colors.textTertiary}
                  />
                  <Text
                    style={[
                      styles.providerButtonText,
                      provider === p.key && { color: p.color },
                    ]}
                  >
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Production API Key"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              editable={!isSaving}
            />
          </View>

          {/* Value Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              {isEditing ? 'New Value (leave blank to keep current)' : 'Secret Value'}
            </Text>
            <TextInput
              style={[styles.input, styles.secretInput]}
              placeholder={isEditing ? 'Enter new value...' : 'sk-...'}
              placeholderTextColor={colors.textTertiary}
              value={value}
              onChangeText={setValue}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSaving}
            />
            <Text style={styles.inputHint}>
              Your secret is encrypted and never exposed in the app.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SecretManagementScreen() {
  const navigation = useNavigation<SecretManagementScreenNavigationProp>();

  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);

  const fetchSecrets = useCallback(async () => {
    if (DEMO_MODE) {
      setSecrets(DEMO_SECRETS);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await secretsApi.list();
      setSecrets(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load secrets');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchSecrets();
  }, [fetchSecrets]);

  const handleAddSecret = () => {
    setEditingSecret(null);
    setModalVisible(true);
  };

  const handleEditSecret = (secret: Secret) => {
    setEditingSecret(secret);
    setModalVisible(true);
  };

  const handleDeleteSecret = (id: string) => {
    Alert.alert(
      'Delete Secret',
      'Are you sure you want to delete this secret? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (DEMO_MODE) {
              setSecrets((prev) => prev.filter((s) => s.id !== id));
              return;
            }
            try {
              await secretsApi.delete(id);
              setSecrets((prev) => prev.filter((s) => s.id !== id));
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete secret');
            }
          },
        },
      ]
    );
  };

  const handleSaveSecret = async (provider: string, name: string, value: string) => {
    if (DEMO_MODE) {
      if (editingSecret) {
        setSecrets((prev) =>
          prev.map((s) =>
            s.id === editingSecret.id
              ? { ...s, name, updatedAt: new Date().toISOString() }
              : s
          )
        );
      } else {
        const newSecret: Secret = {
          id: `demo-${Date.now()}`,
          provider,
          name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setSecrets((prev) => [newSecret, ...prev]);
      }
      return;
    }

    if (editingSecret) {
      await secretsApi.update(editingSecret.id, { name, ...(value ? { value } : {}) });
      fetchSecrets();
    } else {
      await secretsApi.create(provider, name, value);
      fetchSecrets();
    }
  };

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
        <Text style={styles.headerTitle}>API Keys & Secrets</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddSecret}>
          <Ionicons name="add" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Demo Notice */}
      {DEMO_MODE && (
        <View style={styles.demoNotice}>
          <Ionicons name="flask" size={18} color={colors.warning} />
          <Text style={styles.demoNoticeText}>
            Demo mode: Changes are simulated.
          </Text>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading secrets...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={64} color={colors.error} />
          <Text style={styles.errorTitle}>Failed to Load</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
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
          {/* Info Box */}
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={20} color={colors.success} />
            <Text style={styles.infoText}>
              Secrets are encrypted at rest and in transit. Jarvis uses these keys to interact with external services on your behalf.
            </Text>
          </View>

          {/* Secrets List */}
          {secrets.length > 0 ? (
            secrets.map((secret) => (
              <SecretCard
                key={secret.id}
                secret={secret}
                onEdit={handleEditSecret}
                onDelete={handleDeleteSecret}
              />
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="key-outline" size={64} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Secrets Added</Text>
              <Text style={styles.emptySubtitle}>
                Add API keys to enable Jarvis to use AI services and integrations.
              </Text>
              <TouchableOpacity style={styles.addEmptyButton} onPress={handleAddSecret}>
                <Ionicons name="add" size={20} color={colors.textInverse} />
                <Text style={styles.addEmptyButtonText}>Add Your First Secret</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add/Edit Modal */}
      <SecretModal
        visible={modalVisible}
        secret={editingSecret}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveSecret}
      />
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
  addButton: {
    padding: 4,
    width: 40,
    alignItems: 'flex-end',
  },
  demoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.warning}15`,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: `${colors.warning}30`,
  },
  demoNoticeText: {
    fontSize: 13,
    color: colors.warning,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: `${colors.success}10`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: `${colors.success}30`,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  secretCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secretIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  secretInfo: {
    flex: 1,
  },
  secretName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  secretProvider: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  secretDate: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 4,
  },
  secretActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
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
    lineHeight: 20,
  },
  addEmptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 24,
    gap: 8,
  },
  addEmptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  modalCancelText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  modalSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.error}15`,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.error,
  },
  modalErrorText: {
    flex: 1,
    fontSize: 14,
    color: colors.error,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.text,
  },
  secretInput: {
    fontFamily: 'monospace',
  },
  inputHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 6,
  },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  providerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  providerButtonActive: {
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 2,
  },
  providerButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
