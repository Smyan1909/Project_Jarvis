/**
 * Speech Services Factory
 * 
 * Returns the appropriate speech service implementations based on config.
 * Toggle between 'native' and 'elevenlabs' providers in config.ts.
 * 
 * IMPORTANT: This factory uses lazy imports to avoid loading native modules
 * that crash in Expo Go. All native-dependent services are loaded dynamically.
 */

import { SPEECH_CONFIG, SpeechProvider } from '../../config';
import { ISpeechToTextService, ITextToSpeechService, SpeechServices } from './types';

// Stub service - always safe to import (no native dependencies)
import { StubSpeechToText } from './StubSpeechToText';

// Native TTS - uses expo-speech which works in Expo Go
import { NativeTextToSpeech } from './native/NativeTextToSpeech';

// Singleton instances
let sttService: ISpeechToTextService | null = null;
let ttsService: ITextToSpeechService | null = null;

// Track if we've detected native module availability
let nativeModulesChecked = false;
let nativeModulesAvailable = false;

/**
 * Check if native audio modules are available.
 * This is cached after the first check.
 */
function checkNativeModulesAvailable(): boolean {
  if (nativeModulesChecked) {
    return nativeModulesAvailable;
  }
  
  nativeModulesChecked = true;
  
  try {
    // Try to require the native module
    const LiveAudioStream = require('react-native-live-audio-stream').default;
    
    // Check if it has the expected methods
    if (LiveAudioStream && typeof LiveAudioStream.init === 'function') {
      // Additional check: try to see if the native module is actually linked
      // This may throw if the native bindings are missing
      nativeModulesAvailable = true;
      console.log('[SpeechFactory] Native audio modules available');
    } else {
      console.warn('[SpeechFactory] Native audio module found but incomplete');
      nativeModulesAvailable = false;
    }
  } catch (error) {
    console.warn('[SpeechFactory] Native audio modules not available:', error);
    nativeModulesAvailable = false;
  }
  
  return nativeModulesAvailable;
}

/**
 * Lazily load the ElevenLabs STT service.
 * Returns null if native modules are not available.
 */
function loadElevenLabsSTT(): ISpeechToTextService | null {
  if (!checkNativeModulesAvailable()) {
    console.log('[SpeechFactory] Skipping ElevenLabs STT - native modules unavailable');
    return null;
  }
  
  try {
    // Dynamic import to prevent module loading at startup
    const { ElevenLabsLiveStreamSTT } = require('./elevenlabs/ElevenLabsLiveStreamSTT');
    return new ElevenLabsLiveStreamSTT();
  } catch (error) {
    console.error('[SpeechFactory] Failed to load ElevenLabs STT:', error);
    return null;
  }
}

/**
 * Lazily load the Native STT service.
 * Returns null if native modules are not available.
 */
function loadNativeSTT(): ISpeechToTextService | null {
  // Native STT is already stubbed, so it's safe to import
  try {
    const { NativeSpeechToText } = require('./native/NativeSpeechToText');
    return new NativeSpeechToText();
  } catch (error) {
    console.error('[SpeechFactory] Failed to load Native STT:', error);
    return null;
  }
}

/**
 * Get the Speech-to-Text service based on current config.
 * Falls back to StubSpeechToText if native modules are unavailable.
 */
export function getSpeechToTextService(): ISpeechToTextService {
  if (sttService) {
    return sttService;
  }

  const provider = SPEECH_CONFIG.provider;
  
  // Check native module availability first
  const nativeAvailable = checkNativeModulesAvailable();

  if (!nativeAvailable) {
    // In Expo Go or without native modules - use stub
    console.log('[SpeechFactory] Using StubSpeechToText (native modules unavailable)');
    sttService = new StubSpeechToText();
    return sttService;
  }

  // Native modules available - load the appropriate service
  switch (provider) {
    case 'elevenlabs':
      sttService = loadElevenLabsSTT();
      break;
    case 'native':
    default:
      sttService = loadNativeSTT();
      break;
  }

  // Fallback to stub if loading failed
  if (!sttService) {
    console.warn('[SpeechFactory] Service loading failed, using stub');
    sttService = new StubSpeechToText();
  }

  return sttService;
}

/**
 * Lazily load ElevenLabs TTS service.
 */
function loadElevenLabsTTS(): ITextToSpeechService | null {
  try {
    const { ElevenLabsTextToSpeech } = require('./elevenlabs/ElevenLabsTextToSpeech');
    return new ElevenLabsTextToSpeech();
  } catch (error) {
    console.error('[SpeechFactory] Failed to load ElevenLabs TTS:', error);
    return null;
  }
}

/**
 * Get the Text-to-Speech service based on current config.
 * TTS typically works in Expo Go (uses expo-speech or HTTP API).
 */
export function getTextToSpeechService(): ITextToSpeechService {
  if (ttsService) {
    return ttsService;
  }

  const provider = SPEECH_CONFIG.provider;

  switch (provider) {
    case 'elevenlabs':
      ttsService = loadElevenLabsTTS();
      // Fallback to native TTS if ElevenLabs fails
      if (!ttsService) {
        console.warn('[SpeechFactory] ElevenLabs TTS failed, falling back to native');
        ttsService = new NativeTextToSpeech();
      }
      break;
    case 'native':
    default:
      ttsService = new NativeTextToSpeech();
      break;
  }

  return ttsService;
}

/**
 * Get both speech services
 */
export function getSpeechServices(): SpeechServices {
  return {
    stt: getSpeechToTextService(),
    tts: getTextToSpeechService(),
  };
}

/**
 * Get the current speech provider
 */
export function getCurrentProvider(): SpeechProvider {
  return SPEECH_CONFIG.provider;
}

/**
 * Check if using native provider
 */
export function isNativeProvider(): boolean {
  return SPEECH_CONFIG.provider === 'native';
}

/**
 * Check if using ElevenLabs provider
 */
export function isElevenLabsProvider(): boolean {
  return SPEECH_CONFIG.provider === 'elevenlabs';
}

/**
 * Check if native audio modules are available (for UI feedback)
 */
export function areNativeModulesAvailable(): boolean {
  return checkNativeModulesAvailable();
}

/**
 * Reset services (useful for testing or when changing providers at runtime)
 */
export function resetSpeechServices(): void {
  if (sttService) {
    sttService.cleanup();
    sttService = null;
  }
  if (ttsService) {
    ttsService.cleanup();
    ttsService = null;
  }
}

// Re-export types
export * from './types';
