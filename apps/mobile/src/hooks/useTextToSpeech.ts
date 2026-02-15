/**
 * useTextToSpeech Hook
 * 
 * React hook for text-to-speech functionality.
 * Uses the configured speech provider (native or ElevenLabs).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getTextToSpeechService, ITextToSpeechService, Voice, getCurrentProvider } from '../services/speech';
import { TTSOptions } from '../services/speech/types';
import { logger } from '../utils/logger';

export interface UseTextToSpeechReturn {
  /** Whether the service is currently speaking */
  isSpeaking: boolean;
  /** Whether the service is available */
  isAvailable: boolean;
  /** Error message, if any */
  error: string | null;
  /** Available voices */
  voices: Voice[];
  /** Current provider name */
  provider: 'native' | 'elevenlabs';
  /** Speak the given text */
  speak: (text: string, options?: TTSOptions) => Promise<void>;
  /** Stop any ongoing speech */
  stop: () => void;
  /** Pause speech (if supported) */
  pause: () => void;
  /** Resume paused speech (if supported) */
  resume: () => void;
  /** Load available voices */
  loadVoices: () => Promise<void>;
}

export function useTextToSpeech(): UseTextToSpeechReturn {
  logger.info('TTS', 'Initializing useTextToSpeech hook');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  
  const serviceRef = useRef<ITextToSpeechService | null>(null);
  const provider = getCurrentProvider();
  logger.debug('TTS', 'Current provider', { provider });

  // Initialize service and set up callbacks
  useEffect(() => {
    logger.info('TTS', 'Initializing TTS service');
    const service = getTextToSpeechService();
    serviceRef.current = service;

    // Check availability
    service.isAvailable().then((available) => {
      setIsAvailable(available);
      logger.info('TTS', `Service available: ${available}`);
    });

    // Set up callbacks
    service.onStart(() => {
      logger.info('TTS', 'Speech started');
      setIsSpeaking(true);
      setError(null);
    });

    service.onDone(() => {
      logger.info('TTS', 'Speech completed');
      setIsSpeaking(false);
    });

    service.onError((errorMessage) => {
      logger.error('TTS', `Error: ${errorMessage}`);
      setError(errorMessage);
      setIsSpeaking(false);
    });

    // Cleanup on unmount
    return () => {
      logger.info('TTS', 'Cleaning up TTS service');
      service.cleanup();
    };
  }, []);

  const speak = useCallback(async (text: string, options?: TTSOptions) => {
    logger.info('TTS', `Speaking text (length: ${text.length})`);
    const service = serviceRef.current;
    if (!service) {
      logger.error('TTS', 'No TTS service available');
      return;
    }

    setError(null);
    
    try {
      await service.speak(text, options);
      logger.info('TTS', 'Speech request successful');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to speak';
      logger.error('TTS', `Speak error: ${message}`);
      setError(message);
    }
  }, []);

  const stop = useCallback(() => {
    logger.info('TTS', 'Stopping speech');
    const service = serviceRef.current;
    if (service) {
      service.stop();
      setIsSpeaking(false);
    }
  }, []);

  const pause = useCallback(() => {
    logger.debug('TTS', 'Pausing speech');
    const service = serviceRef.current;
    if (service) {
      service.pause();
    }
  }, []);

  const resume = useCallback(() => {
    logger.debug('TTS', 'Resuming speech');
    const service = serviceRef.current;
    if (service) {
      service.resume();
    }
  }, []);

  const loadVoices = useCallback(async () => {
    logger.info('TTS', 'Loading available voices');
    const service = serviceRef.current;
    if (!service) {
      logger.warn('TTS', 'Cannot load voices - no service available');
      return;
    }

    try {
      const availableVoices = await service.getAvailableVoices();
      logger.info('TTS', `Loaded ${availableVoices.length} voices`);
      setVoices(availableVoices);
    } catch (e) {
      logger.error('TTS', 'Failed to load voices', e);
    }
  }, []);

  return {
    isSpeaking,
    isAvailable,
    error,
    voices,
    provider,
    speak,
    stop,
    pause,
    resume,
    loadVoices,
  };
}
