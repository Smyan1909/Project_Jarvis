/**
 * Speech Services Factory
 * 
 * Returns the appropriate speech service implementations based on config.
 * Toggle between 'native' and 'elevenlabs' providers in config.ts.
 */

import { SPEECH_CONFIG, SpeechProvider } from '../../config';
import { ISpeechToTextService, ITextToSpeechService, SpeechServices } from './types';

// Native implementations
import { NativeSpeechToText } from './native/NativeSpeechToText';
import { NativeTextToSpeech } from './native/NativeTextToSpeech';

// ElevenLabs implementations
import { ElevenLabsRESTSTT } from './elevenlabs/ElevenLabsRESTSTT';
import { ElevenLabsTextToSpeech } from './elevenlabs/ElevenLabsTextToSpeech';

// Singleton instances
let sttService: ISpeechToTextService | null = null;
let ttsService: ITextToSpeechService | null = null;

/**
 * Get the Speech-to-Text service based on current config
 */
export function getSpeechToTextService(): ISpeechToTextService {
  if (sttService) {
    return sttService;
  }

  const provider = SPEECH_CONFIG.provider;

  switch (provider) {
    case 'elevenlabs':
      sttService = new ElevenLabsRESTSTT();
      break;
    case 'native':
    default:
      sttService = new NativeSpeechToText();
      break;
  }

  return sttService;
}

/**
 * Get the Text-to-Speech service based on current config
 */
export function getTextToSpeechService(): ITextToSpeechService {
  if (ttsService) {
    return ttsService;
  }

  const provider = SPEECH_CONFIG.provider;

  switch (provider) {
    case 'elevenlabs':
      ttsService = new ElevenLabsTextToSpeech();
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
