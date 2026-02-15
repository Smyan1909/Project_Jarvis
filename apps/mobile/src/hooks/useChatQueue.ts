// =============================================================================
// useChatQueue Hook
// =============================================================================
// Manages a queue of messages for sequential processing, allowing users to
// submit multiple messages while previous ones are still being processed.

import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '../utils/logger';

// =============================================================================
// Types
// =============================================================================

export type QueueItemStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface QueueItem {
  id: string;
  content: string;
  status: QueueItemStatus;
  addedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface UseChatQueueOptions {
  /** Function to process a message (should return when complete) */
  processMessage: (content: string) => Promise<void>;
  /** Maximum number of items to keep in queue history */
  maxQueueHistory?: number;
}

export interface UseChatQueueReturn {
  /** Current queue items */
  queue: QueueItem[];
  /** Number of pending items (queued + processing) */
  pendingCount: number;
  /** Whether any message is currently being processed */
  isProcessing: boolean;
  /** Add a message to the queue */
  enqueue: (content: string) => void;
  /** Clear completed/failed items from the queue */
  clearCompleted: () => void;
  /** Clear all items from the queue (cancels processing) */
  clearAll: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useChatQueue({
  processMessage,
  maxQueueHistory = 10,
}: UseChatQueueOptions): UseChatQueueReturn {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const processMessageRef = useRef(processMessage);

  // Keep processMessage ref up to date
  useEffect(() => {
    processMessageRef.current = processMessage;
  }, [processMessage]);

  // Process the next item in the queue
  const processNext = useCallback(async () => {
    if (isProcessingRef.current) {
      logger.debug('ChatQueue', 'Already processing, skipping');
      return;
    }

    // Find the next queued item
    const nextItem = queue.find((item) => item.status === 'queued');
    if (!nextItem) {
      logger.debug('ChatQueue', 'No queued items to process');
      return;
    }

    logger.info('ChatQueue', `Processing queue item: ${nextItem.id}`);
    isProcessingRef.current = true;

    // Mark as processing
    setQueue((prev) =>
      prev.map((item) =>
        item.id === nextItem.id
          ? { ...item, status: 'processing' as const, startedAt: new Date() }
          : item
      )
    );

    try {
      // Process the message
      await processMessageRef.current(nextItem.content);

      // Mark as completed
      logger.info('ChatQueue', `Queue item completed: ${nextItem.id}`);
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? { ...item, status: 'completed' as const, completedAt: new Date() }
            : item
        )
      );
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('ChatQueue', `Queue item failed: ${nextItem.id}`, { error: errorMessage });
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? { ...item, status: 'failed' as const, completedAt: new Date(), error: errorMessage }
            : item
        )
      );
    } finally {
      isProcessingRef.current = false;
    }
  }, [queue]);

  // Process queue when items are added or processing completes
  useEffect(() => {
    const hasQueuedItems = queue.some((item) => item.status === 'queued');
    if (hasQueuedItems && !isProcessingRef.current) {
      processNext();
    }
  }, [queue, processNext]);

  // Add a message to the queue
  const enqueue = useCallback((content: string) => {
    const newItem: QueueItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      status: 'queued',
      addedAt: new Date(),
    };

    logger.info('ChatQueue', `Enqueuing message: ${newItem.id} (length: ${content.length})`);

    setQueue((prev) => {
      // Add new item and trim old completed items if needed
      const newQueue = [...prev, newItem];
      
      // Keep only recent completed items
      const pendingItems = newQueue.filter(
        (item) => item.status === 'queued' || item.status === 'processing'
      );
      const completedItems = newQueue
        .filter((item) => item.status === 'completed' || item.status === 'failed')
        .slice(-maxQueueHistory);

      const finalQueue = [...pendingItems, ...completedItems].sort(
        (a, b) => a.addedAt.getTime() - b.addedAt.getTime()
      );

      logger.debug('ChatQueue', `Queue updated: ${pendingItems.length} pending, ${completedItems.length} completed`);
      return finalQueue;
    });
  }, [maxQueueHistory]);

  // Clear completed/failed items
  const clearCompleted = useCallback(() => {
    logger.info('ChatQueue', 'Clearing completed items');
    setQueue((prev) => {
      const cleared = prev.filter((item) => item.status === 'queued' || item.status === 'processing');
      logger.debug('ChatQueue', `Cleared ${prev.length - cleared.length} completed items`);
      return cleared;
    });
  }, []);

  // Clear all items
  const clearAll = useCallback(() => {
    logger.info('ChatQueue', 'Clearing all queue items');
    setQueue([]);
    isProcessingRef.current = false;
  }, []);

  // Calculate derived state
  const pendingCount = queue.filter(
    (item) => item.status === 'queued' || item.status === 'processing'
  ).length;

  const isProcessing = queue.some((item) => item.status === 'processing');

  return {
    queue,
    pendingCount,
    isProcessing,
    enqueue,
    clearCompleted,
    clearAll,
  };
}
