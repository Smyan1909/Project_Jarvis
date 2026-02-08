// =============================================================================
// Task Observability Panel
// =============================================================================
// Slide-in drawer showing orchestrator status, plan, active agents, and activity log.

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useTaskObservabilityContext, OrchestratorStatus, AgentInfo } from '../features/observability/TaskObservabilityContext';
import { TaskCard } from './TaskCard';
import { AgentActivityItem } from './AgentActivityItem';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PANEL_WIDTH = SCREEN_WIDTH * 0.85;

// =============================================================================
// Helpers
// =============================================================================

function getStatusColor(status: OrchestratorStatus): string {
  switch (status) {
    case 'idle':
      return colors.textSecondary;
    case 'planning':
      return colors.warning;
    case 'executing':
      return colors.primary;
    case 'monitoring':
      return colors.info;
    case 'completed':
      return colors.success;
    case 'failed':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

function getStatusIcon(status: OrchestratorStatus): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'idle':
      return 'pause-circle-outline';
    case 'planning':
      return 'bulb-outline';
    case 'executing':
      return 'flash-outline';
    case 'monitoring':
      return 'eye-outline';
    case 'completed':
      return 'checkmark-circle-outline';
    case 'failed':
      return 'close-circle-outline';
    default:
      return 'ellipse-outline';
  }
}

function formatStatusLabel(status: OrchestratorStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'planning':
      return 'Planning...';
    case 'executing':
      return 'Executing';
    case 'monitoring':
      return 'Monitoring';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

// =============================================================================
// Props
// =============================================================================

interface TaskObservabilityPanelProps {
  visible: boolean;
  onClose: () => void;
  translateX?: Animated.Value;
}

// =============================================================================
// Active Agent Card
// =============================================================================

function ActiveAgentCard({ agent }: { agent: AgentInfo }) {
  const agentColors: Record<string, string> = {
    general: colors.agentGeneral,
    research: colors.agentResearch,
    coding: colors.agentCoding,
    scheduling: colors.agentScheduling,
    productivity: colors.agentProductivity,
    messaging: colors.agentMessaging,
  };
  
  const color = agentColors[agent.type] || colors.textSecondary;

  return (
    <View style={[styles.agentCard, { borderColor: color }]}>
      <View style={styles.agentCardHeader}>
        <View style={[styles.agentDot, { backgroundColor: color }]} />
        <Text style={[styles.agentType, { color }]}>
          {agent.type.toUpperCase()}
        </Text>
        <View style={[
          styles.agentStatusBadge,
          { backgroundColor: agent.status === 'running' ? `${colors.success}20` : `${colors.textSecondary}20` }
        ]}>
          <Text style={[
            styles.agentStatusText,
            { color: agent.status === 'running' ? colors.success : colors.textSecondary }
          ]}>
            {agent.status}
          </Text>
        </View>
      </View>
      <Text style={styles.agentTask} numberOfLines={2}>
        {agent.taskDescription}
      </Text>
      {agent.currentAction && (
        <Text style={styles.agentAction} numberOfLines={1}>
          {agent.currentAction}
        </Text>
      )}
    </View>
  );
}

// =============================================================================
// Component
// =============================================================================

export function TaskObservabilityPanel({
  visible,
  onClose,
  translateX,
}: TaskObservabilityPanelProps) {
  const { state } = useTaskObservabilityContext();
  const { status, statusMessage, plan, activeAgents, activityLog } = state;

  const statusColor = getStatusColor(status);
  const statusIcon = getStatusIcon(status);

  const activeAgentsList = Array.from(activeAgents.values());
  const completedTasks = plan?.tasks.filter((t) => t.status === 'completed').length ?? 0;
  const totalTasks = plan?.tasks.length ?? 0;

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      {/* Backdrop */}
      <TouchableOpacity
        style={styles.backdrop}
        onPress={handleClose}
        activeOpacity={1}
      />

      {/* Panel */}
      <Animated.View
        style={[
          styles.panel,
          translateX && { transform: [{ translateX }] },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="hardware-chip" size={24} color={colors.primary} />
            <Text style={styles.headerTitle}>Task Monitor</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContentInner}
          showsVerticalScrollIndicator={false}
        >
          {/* Status Section */}
          <View style={styles.section}>
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <Ionicons name={statusIcon} size={24} color={statusColor} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {formatStatusLabel(status)}
                </Text>
              </View>
              {statusMessage && (
                <Text style={styles.statusMessage}>{statusMessage}</Text>
              )}
              {totalTasks > 0 && (
                <View style={styles.progressRow}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${(completedTasks / totalTasks) * 100}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {completedTasks}/{totalTasks}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Active Agents Section */}
          {activeAgentsList.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
                <Text style={styles.sectionTitle}>Active Agents</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{activeAgentsList.length}</Text>
                </View>
              </View>
              {activeAgentsList.map((agent) => (
                <ActiveAgentCard key={agent.id} agent={agent} />
              ))}
            </View>
          )}

          {/* Plan Section */}
          {plan && plan.tasks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="list-outline" size={18} color={colors.primary} />
                <Text style={styles.sectionTitle}>Execution Plan</Text>
                <View style={styles.structureBadge}>
                  <Text style={styles.structureText}>{plan.structure}</Text>
                </View>
              </View>
              {plan.tasks.map((task, index) => (
                <TaskCard key={task.id} task={task} index={index} />
              ))}
            </View>
          )}

          {/* Activity Log Section */}
          {activityLog.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                <Text style={styles.sectionTitle}>Activity Log</Text>
              </View>
              <View style={styles.activityContainer}>
                {activityLog.slice(0, 20).map((entry, index) => (
                  <AgentActivityItem
                    key={entry.id}
                    entry={entry}
                    isLast={index === Math.min(activityLog.length - 1, 19)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Empty State */}
          {status === 'idle' && !plan && activityLog.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="sparkles-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Active Tasks</Text>
              <Text style={styles.emptyText}>
                Send a message to start a new task and see the AI agents work in real-time.
              </Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  panel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.background,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentInner: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textInverse,
  },
  structureBadge: {
    backgroundColor: colors.backgroundTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  structureText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  statusCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
  },
  statusMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 18,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  agentCard: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  agentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  agentType: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  agentStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  agentStatusText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  agentTask: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  agentAction: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  activityContainer: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
    paddingHorizontal: 24,
  },
});
