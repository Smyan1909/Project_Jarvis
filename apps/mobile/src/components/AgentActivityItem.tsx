// =============================================================================
// Agent Activity Item
// =============================================================================
// Displays a single entry in the activity log (tool calls, agent actions, etc.)

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { ActivityLogEntry, ActivityLogEntryType } from '../features/observability/TaskObservabilityContext';

// =============================================================================
// Icon Mapping
// =============================================================================

function getActivityIcon(type: ActivityLogEntryType): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  switch (type) {
    case 'status':
      return { name: 'information-circle', color: colors.info };
    case 'plan_created':
      return { name: 'list', color: colors.primary };
    case 'task_started':
      return { name: 'play-circle', color: colors.taskInProgress };
    case 'task_completed':
      return { name: 'checkmark-circle', color: colors.taskCompleted };
    case 'agent_spawned':
      return { name: 'add-circle', color: colors.success };
    case 'agent_terminated':
      return { name: 'remove-circle', color: colors.textSecondary };
    case 'tool_call':
      return { name: 'hammer', color: colors.warning };
    case 'tool_result':
      return { name: 'checkmark-done', color: colors.success };
    case 'reasoning':
      return { name: 'bulb', color: colors.accent };
    case 'intervention':
      return { name: 'hand-left', color: colors.warning };
    case 'error':
      return { name: 'alert-circle', color: colors.error };
    case 'token':
      return { name: 'text', color: colors.textTertiary };
    default:
      return { name: 'ellipse', color: colors.textSecondary };
  }
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// =============================================================================
// Props
// =============================================================================

interface AgentActivityItemProps {
  entry: ActivityLogEntry;
  isLast?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function AgentActivityItem({ entry, isLast = false }: AgentActivityItemProps) {
  const icon = getActivityIcon(entry.type);

  // Check if details should be rendered
  const hasDetails = entry.details && 
    typeof entry.details === 'object' && 
    Object.keys(entry.details as Record<string, unknown>).length > 0;

  return (
    <View style={[styles.container, isLast && styles.containerLast]}>
      {/* Timeline indicator */}
      <View style={styles.timelineContainer}>
        <View style={[styles.iconContainer, { backgroundColor: `${icon.color}20` }]}>
          <Ionicons name={icon.name} size={14} color={icon.color} />
        </View>
        {!isLast && <View style={styles.timelineLine} />}
      </View>

      {/* Content */}
      <View style={styles.contentContainer}>
        <View style={styles.headerRow}>
          <Text style={styles.typeLabel}>{formatTypeLabel(entry.type)}</Text>
          <Text style={styles.timestamp}>{formatTimestamp(entry.timestamp)}</Text>
        </View>
        <Text style={styles.message}>{entry.message}</Text>
        {hasDetails ? (
          <View style={styles.detailsContainer}>
            <Text style={styles.detailsText} numberOfLines={3}>
              {JSON.stringify(entry.details as object, null, 2)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function formatTypeLabel(type: ActivityLogEntryType): string {
  switch (type) {
    case 'status':
      return 'Status';
    case 'plan_created':
      return 'Plan Created';
    case 'task_started':
      return 'Task Started';
    case 'task_completed':
      return 'Task Completed';
    case 'agent_spawned':
      return 'Agent Spawned';
    case 'agent_terminated':
      return 'Agent Terminated';
    case 'tool_call':
      return 'Tool Call';
    case 'tool_result':
      return 'Tool Result';
    case 'reasoning':
      return 'Reasoning';
    case 'intervention':
      return 'Intervention Required';
    case 'error':
      return 'Error';
    case 'token':
      return 'Output';
    default:
      return 'Event';
  }
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingBottom: 12,
  },
  containerLast: {
    paddingBottom: 0,
  },
  timelineContainer: {
    alignItems: 'center',
    marginRight: 12,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  contentContainer: {
    flex: 1,
    paddingTop: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textTertiary,
    fontFamily: 'monospace',
  },
  message: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  detailsContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
});
