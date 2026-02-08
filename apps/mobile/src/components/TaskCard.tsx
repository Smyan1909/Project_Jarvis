// =============================================================================
// Task Card
// =============================================================================
// Displays a single task from the orchestrator's plan with status indicator.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { TaskInfo, TaskStatus, AgentType } from '../features/observability/TaskObservabilityContext';

// =============================================================================
// Helpers
// =============================================================================

function getStatusIcon(status: TaskStatus): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  switch (status) {
    case 'pending':
      return { name: 'time-outline', color: colors.taskPending };
    case 'in_progress':
      return { name: 'sync', color: colors.taskInProgress };
    case 'completed':
      return { name: 'checkmark-circle', color: colors.taskCompleted };
    case 'failed':
      return { name: 'close-circle', color: colors.taskFailed };
    default:
      return { name: 'ellipse-outline', color: colors.textTertiary };
  }
}

function getAgentTypeColor(agentType: AgentType): string {
  switch (agentType) {
    case 'general':
      return colors.agentGeneral;
    case 'research':
      return colors.agentResearch;
    case 'coding':
      return colors.agentCoding;
    case 'scheduling':
      return colors.agentScheduling;
    case 'productivity':
      return colors.agentProductivity;
    case 'messaging':
      return colors.agentMessaging;
    default:
      return colors.textSecondary;
  }
}

function getAgentTypeIcon(agentType: AgentType): keyof typeof Ionicons.glyphMap {
  switch (agentType) {
    case 'general':
      return 'cube-outline';
    case 'research':
      return 'search-outline';
    case 'coding':
      return 'code-slash-outline';
    case 'scheduling':
      return 'calendar-outline';
    case 'productivity':
      return 'checkmark-done-outline';
    case 'messaging':
      return 'chatbubbles-outline';
    default:
      return 'cube-outline';
  }
}

function formatDuration(startedAt: Date | null, completedAt: Date | null): string | null {
  if (!startedAt) return null;
  const end = completedAt || new Date();
  const durationMs = end.getTime() - startedAt.getTime();
  
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${(durationMs / 60000).toFixed(1)}m`;
}

function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in_progress':
      return 'In Progress';
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

interface TaskCardProps {
  task: TaskInfo;
  index: number;
}

// =============================================================================
// Component
// =============================================================================

export function TaskCard({ task, index }: TaskCardProps) {
  const statusIcon = getStatusIcon(task.status);
  const agentColor = getAgentTypeColor(task.agentType);
  const agentIcon = getAgentTypeIcon(task.agentType);
  const duration = formatDuration(task.startedAt, task.completedAt);
  const isActive = task.status === 'in_progress';

  return (
    <View style={[
      styles.container,
      isActive && styles.containerActive,
      task.status === 'failed' && styles.containerFailed,
    ]}>
      {/* Task number and status */}
      <View style={styles.leftSection}>
        <View style={[styles.numberBadge, { backgroundColor: `${agentColor}20` }]}>
          <Text style={[styles.numberText, { color: agentColor }]}>{index + 1}</Text>
        </View>
        <View style={styles.statusContainer}>
          <Ionicons name={statusIcon.name} size={18} color={statusIcon.color} />
        </View>
      </View>

      {/* Task content */}
      <View style={styles.contentSection}>
        <Text style={styles.description} numberOfLines={2}>
          {task.description}
        </Text>
        
        <View style={styles.metaRow}>
          {/* Agent type badge */}
          <View style={[styles.agentBadge, { backgroundColor: `${agentColor}15`, borderColor: agentColor }]}>
            <Ionicons name={agentIcon} size={12} color={agentColor} />
            <Text style={[styles.agentBadgeText, { color: agentColor }]}>
              {task.agentType}
            </Text>
          </View>

          {/* Status label */}
          <Text style={[styles.statusLabel, { color: statusIcon.color }]}>
            {getStatusLabel(task.status)}
          </Text>

          {/* Duration */}
          {duration && (
            <Text style={styles.durationText}>{duration}</Text>
          )}
        </View>

        {/* Error message */}
        {task.error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={14} color={colors.error} />
            <Text style={styles.errorText} numberOfLines={2}>
              {task.error}
            </Text>
          </View>
        )}
      </View>

      {/* Active indicator */}
      {isActive && (
        <View style={styles.activeIndicator} />
      )}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  containerActive: {
    borderColor: colors.taskInProgress,
    backgroundColor: `${colors.taskInProgress}08`,
  },
  containerFailed: {
    borderColor: colors.error,
    backgroundColor: `${colors.error}08`,
  },
  leftSection: {
    alignItems: 'center',
    marginRight: 12,
  },
  numberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  numberText: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusContainer: {
    marginTop: 2,
  },
  contentSection: {
    flex: 1,
  },
  description: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  agentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  durationText: {
    fontSize: 11,
    color: colors.textTertiary,
    fontFamily: 'monospace',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    padding: 8,
    backgroundColor: `${colors.error}10`,
    borderRadius: 6,
    gap: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
    lineHeight: 16,
  },
  activeIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.taskInProgress,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
});
