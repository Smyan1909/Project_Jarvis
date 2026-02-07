/**
 * Stub Speech-to-Text Service
 * 
 * Used as a fallback when native audio modules are not available (e.g., Expo Go).
 * Provides a graceful error message instead of crashing the app.
 */

import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from './types';

const NOT_AVAILABLE_MESSAGE = 'Voice recording requires a development build. Run: npx expo run:android';

export class StubSpeechToText implements ISpeechToTextService {
  private errorCallback: STTErrorCallback | null = null;

  constructor() {
    console.log('[StubSpeechToText] Using stub - native audio not available');
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async requestPermission(): Promise<boolean> {
    return false;
  }

  async startListening(_options?: STTOptions): Promise<void> {
    console.warn('[StubSpeechToText] Cannot start - native modules not available');
    // Delay slightly so the UI can update before showing error
    setTimeout(() => {
      this.errorCallback?.(NOT_AVAILABLE_MESSAGE);
    }, 100);
  }

  async stopListening(): Promise<void> {
    // No-op
  }

  onPartialResult(_callback: STTResultCallback): void {
    // No-op
  }

  onFinalResult(_callback: STTResultCallback): void {
    // No-op
  }

  onError(callback: STTErrorCallback): void {
    this.errorCallback = callback;
  }

  cleanup(): void {
    // No-op
  }
}
