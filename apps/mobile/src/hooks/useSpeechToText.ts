/**
 * useSpeechToText Hook
 * 
 * React hook for speech-to-text functionality.
 * Uses the configured speech provider (native or ElevenLabs).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getSpeechToTextService, ISpeechToTextService, getCurrentProvider } from '../services/speech';

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
    console.log('[useSpeechToText] Initializing speech service');
    const service = getSpeechToTextService();
    serviceRef.current = service;

    // Ensure service is initialized (important for singleton reuse)
    if (service.ensureInitialized) {
      service.ensureInitialized();
    }

    // Check availability
    service.isAvailable().then((available) => {
      console.log('[useSpeechToText] Service available:', available);
      setIsAvailable(available);
    });

    // Set up callbacks
    console.log('[useSpeechToText] Registering callbacks');
    service.onPartialResult((text) => {
      console.log('[useSpeechToText] Partial result received:', text);
      setTranscription(text);
    });

    service.onFinalResult((text) => {
      console.log('[useSpeechToText] Final result received:', text);
      setTranscription(text);
      setIsListening(false);
    });

    service.onError((errorMessage) => {
      console.log('[useSpeechToText] Error received:', errorMessage);
      setError(errorMessage);
      setIsListening(false);
    });

    // Cleanup on unmount
    return () => {
      console.log('[useSpeechToText] Cleanup called');
      service.cleanup();
    };
  }, []);

  const startListening = useCallback(async () => {
    console.log('[useSpeechToText] startListening called');
    const service = serviceRef.current;
    if (!service) {
      console.log('[useSpeechToText] No service available');
      return;
    }

    setError(null);
    setTranscription('');

    try {
      // Permission is checked inside startListening() - no need to call it twice
      setIsListening(true);
      console.log('[useSpeechToText] Calling service.startListening()');
      await service.startListening({
        interimResults: true,
        continuous: true,
      });
      console.log('[useSpeechToText] service.startListening() completed');
    } catch (e) {
      console.log('[useSpeechToText] startListening error:', e);
      setError('Failed to start speech recognition.');
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;

    try {
      await service.stopListening();
    } catch {
      // Ignore stop errors
    }
    setIsListening(false);
  }, []);

  const resetTranscription = useCallback(() => {
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
