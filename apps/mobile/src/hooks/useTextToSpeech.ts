/**
 * useTextToSpeech Hook
 * 
 * React hook for text-to-speech functionality.
 * Uses the configured speech provider (native or ElevenLabs).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getTextToSpeechService, ITextToSpeechService, Voice, getCurrentProvider } from '../services/speech';
import { TTSOptions } from '../services/speech/types';

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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  
  const serviceRef = useRef<ITextToSpeechService | null>(null);
  const provider = getCurrentProvider();

  // Initialize service and set up callbacks
  useEffect(() => {
    const service = getTextToSpeechService();
    serviceRef.current = service;

    // Check availability
    service.isAvailable().then(setIsAvailable);

    // Set up callbacks
    service.onStart(() => {
      setIsSpeaking(true);
      setError(null);
    });

    service.onDone(() => {
      setIsSpeaking(false);
    });

    service.onError((errorMessage) => {
      setError(errorMessage);
      setIsSpeaking(false);
    });

    // Cleanup on unmount
    return () => {
      service.cleanup();
    };
  }, []);

  const speak = useCallback(async (text: string, options?: TTSOptions) => {
    const service = serviceRef.current;
    if (!service) return;

    setError(null);
    
    try {
      await service.speak(text, options);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to speak';
      setError(message);
    }
  }, []);

  const stop = useCallback(() => {
    const service = serviceRef.current;
    if (service) {
      service.stop();
      setIsSpeaking(false);
    }
  }, []);

  const pause = useCallback(() => {
    const service = serviceRef.current;
    if (service) {
      service.pause();
    }
  }, []);

  const resume = useCallback(() => {
    const service = serviceRef.current;
    if (service) {
      service.resume();
    }
  }, []);

  const loadVoices = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;

    try {
      const availableVoices = await service.getAvailableVoices();
      setVoices(availableVoices);
    } catch {
      // Ignore voice loading errors
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
