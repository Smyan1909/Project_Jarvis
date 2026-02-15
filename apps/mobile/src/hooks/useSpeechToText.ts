/**
 * useSpeechToText Hook
 * 
 * React hook for speech-to-text functionality.
 * Uses the configured speech provider (native or ElevenLabs).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getSpeechToTextService, ISpeechToTextService, getCurrentProvider } from '../services/speech';
import { logger } from '../utils/logger';

export interface UseSpeechToTextReturn {
  /** Whether the service is currently listening */
  isListening: boolean;
  /** Whether the service is available */
  isAvailable: boolean;
  /** Current transcription (partial or final) */
  transcription: string;
  /** Error message, if any */
  error: string | null;
  /** Current provider name */
  provider: 'native' | 'elevenlabs';
  /** Start listening for speech */
  startListening: () => Promise<void>;
  /** Stop listening and finalize transcription */
  stopListening: () => Promise<void>;
  /** Reset transcription and error state */
  resetTranscription: () => void;
}

export function useSpeechToText(): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const serviceRef = useRef<ISpeechToTextService | null>(null);
  const provider = getCurrentProvider();

  // Initialize service and set up callbacks
  useEffect(() => {
    logger.info('STT', 'Initializing speech-to-text service');
    const service = getSpeechToTextService();
    serviceRef.current = service;

    // Ensure service is initialized (important for singleton reuse)
    if (service.ensureInitialized) {
      service.ensureInitialized();
    }

    // Check availability
    service.isAvailable().then((available) => {
      logger.info('STT', `Service available: ${available}`);
      setIsAvailable(available);
    });

    // Set up callbacks
    logger.debug('STT', 'Registering callbacks');
    service.onPartialResult((text) => {
      logger.debug('STT', `Partial result: "${text}"`);
      setTranscription(text);
    });

    service.onFinalResult((text) => {
      logger.info('STT', `Final result received (length: ${text.length})`);
      setTranscription(text);
      setIsListening(false);
    });

    service.onError((errorMessage) => {
      logger.error('STT', `Error: ${errorMessage}`);
      setError(errorMessage);
      setIsListening(false);
    });

    // Cleanup on unmount
    return () => {
      logger.info('STT', 'Cleaning up STT service');
      service.cleanup();
    };
  }, []);

  const startListening = useCallback(async () => {
    logger.info('STT', 'startListening called');
    const service = serviceRef.current;
    if (!service) {
      logger.error('STT', 'No service available');
      return;
    }

    setError(null);
    setTranscription('');

    try {
      // Permission is checked inside startListening() - no need to call it twice
      setIsListening(true);
      logger.debug('STT', 'Calling service.startListening()');
      await service.startListening({
        interimResults: true,
        continuous: true,
      });
      logger.info('STT', 'Listening started successfully');
    } catch (e) {
      logger.error('STT', 'startListening error', e);
      setError('Failed to start speech recognition.');
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(async () => {
    logger.info('STT', 'stopListening called');
    const service = serviceRef.current;
    if (!service) {
      logger.warn('STT', 'No service available to stop');
      return;
    }

    try {
      await service.stopListening();
      logger.info('STT', 'Listening stopped');
    } catch (e) {
      logger.warn('STT', 'Error stopping listening (ignored)', e);
    }
    setIsListening(false);
  }, []);

  const resetTranscription = useCallback(() => {
    logger.debug('STT', 'Resetting transcription');
    setTranscription('');
    setError(null);
  }, []);

  return {
    isListening,
    isAvailable,
    transcription,
    error,
    provider,
    startListening,
    stopListening,
    resetTranscription,
  };
}
