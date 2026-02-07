/**
 * Native Speech-to-Text Service (STUB)
 * 
 * This is a stub implementation that gracefully handles missing native modules.
 * The real expo-speech-recognition requires a development build and crashes in Expo Go.
 * 
 * When running in Expo Go, this stub returns "not available" instead of crashing.
 * Use ElevenLabs provider for speech-to-text functionality in Expo Go.
 */

import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

const NOT_AVAILABLE_MESSAGE = 'Native speech recognition requires a development build. Please use ElevenLabs provider or run: npx expo run:android';

export class NativeSpeechToText implements ISpeechToTextService {
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;

  constructor() {
    console.log('[NativeSpeechToText] Stub loaded - native modules not available in Expo Go');
  }

  async isAvailable(): Promise<boolean> {
    // Native speech recognition is not available in Expo Go
    return false;
  }

  async requestPermission(): Promise<boolean> {
    // Cannot request permission without native module
    return false;
  }

  async startListening(_options?: STTOptions): Promise<void> {
    console.warn('[NativeSpeechToText] Cannot start - native modules not available');
    this.errorCallback?.(NOT_AVAILABLE_MESSAGE);
  }

  async stopListening(): Promise<void> {
    // No-op in stub
  }

  onPartialResult(callback: STTResultCallback): void {
    this.partialResultCallback = callback;
  }

  onFinalResult(callback: STTResultCallback): void {
    this.finalResultCallback = callback;
  }

  onError(callback: STTErrorCallback): void {
    this.errorCallback = callback;
  }

  ensureInitialized(): void {
    // No-op in stub
  }

  cleanup(): void {
    // No-op in stub
  }
}
