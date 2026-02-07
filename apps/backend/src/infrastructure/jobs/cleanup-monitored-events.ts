// =============================================================================
// Cleanup Monitored Events Job
// =============================================================================
// Scheduled job to delete monitored events older than the retention period.
// Default retention is 30 days.

import { logger } from '../logging/logger.js';
import { MonitoredEventRepository } from '../../adapters/storage/monitored-event-repository.js';

// =============================================================================
// Configuration
// =============================================================================

const RETENTION_DAYS = parseInt(process.env.MONITORED_EVENT_RETENTION_DAYS || '30', 10);

// =============================================================================
// Job Function
// =============================================================================

/**
 * Clean up monitored events older than the retention period
 * 
 * @param retentionDays - Number of days to retain events (default: 30)
 * @returns Number of events deleted
 */
export async function cleanupMonitoredEvents(
  retentionDays: number = RETENTION_DAYS
): Promise<number> {
  const log = logger.child({ job: 'cleanupMonitoredEvents' });
  
  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    log.info('Starting monitored events cleanup', {
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
    });

    // Delete old events
    const eventRepo = new MonitoredEventRepository();
    const deletedCount = await eventRepo.deleteOlderThan(cutoffDate);

    log.info('Monitored events cleanup complete', {
      deletedCount,
      retentionDays,
    });

    return deletedCount;
  } catch (error) {
    log.error('Monitored events cleanup failed', error);
    throw error;
  }
}

// =============================================================================
// Standalone Execution
// =============================================================================

/**
 * Run the cleanup job when executed directly
 * 
 * Usage: npx tsx src/infrastructure/jobs/cleanup-monitored-events.ts
 */
async function main() {
  console.log('Running monitored events cleanup job...');
  
  try {
    const deleted = await cleanupMonitoredEvents();
    console.log(`Cleanup complete. Deleted ${deleted} events.`);
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

// Check if running directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

// =============================================================================
// Cron Integration Helper
// =============================================================================

/**
 * Schedule the cleanup job to run periodically
 * 
 * This is a helper for integrating with cron-like schedulers.
 * 
 * Example with node-cron:
 * ```typescript
 * import cron from 'node-cron';
 * import { scheduleCleanup } from './infrastructure/jobs/cleanup-monitored-events.js';
 * 
 * // Run daily at 3 AM
 * scheduleCleanup('0 3 * * *');
 * ```
 * 
 * Example with setInterval (simple approach):
 * ```typescript
 * import { cleanupMonitoredEvents } from './infrastructure/jobs/cleanup-monitored-events.js';
 * 
 * // Run every 24 hours
 * setInterval(() => cleanupMonitoredEvents(), 24 * 60 * 60 * 1000);
 * ```
 */
export function scheduleCleanup(cronExpression?: string): void {
  const log = logger.child({ job: 'cleanupMonitoredEvents' });
  
  // For now, use a simple interval-based approach
  // Can be upgraded to use node-cron for more complex scheduling
  const intervalMs = 24 * 60 * 60 * 1000; // 24 hours
  
  log.info('Scheduling monitored events cleanup', {
    intervalHours: 24,
    retentionDays: RETENTION_DAYS,
  });

  // Run immediately on startup, then every 24 hours
  cleanupMonitoredEvents().catch((err) => {
    log.error('Initial cleanup failed', err);
  });

  setInterval(() => {
    cleanupMonitoredEvents().catch((err) => {
      log.error('Scheduled cleanup failed', err);
    });
  }, intervalMs);
}
