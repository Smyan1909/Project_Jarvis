/**
 * Native Text-to-Speech Service
 * 
 * Uses expo-speech for device-native TTS.
 * Works in Expo Go and production builds.
 * Free and unlimited usage.
 */

import * as Speech from 'expo-speech';
import {
  ITextToSpeechService,
  TTSOptions,
  Voice,
  TTSEventCallback,
  TTSErrorCallback,
} from '../types';
import { SPEECH_CONFIG } from '../../../config';

export class NativeTextToSpeech implements ITextToSpeechService {
  private speaking: boolean = false;
  private onStartCallback: TTSEventCallback | null = null;
  private onDoneCallback: TTSEventCallback | null = null;
  private onErrorCallback: TTSErrorCallback | null = null;

  async isAvailable(): Promise<boolean> {
    // expo-speech is always available on iOS and Android
    return true;
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    if (!text.trim()) {
      return;
    }

    // Stop any ongoing speech first
    this.stop();

    const config = SPEECH_CONFIG.native;

    try {
      this.speaking = true;
      this.onStartCallback?.();

      await Speech.speak(text, {
        language: options?.language || config.language,
        rate: options?.rate || config.speechRate,
        pitch: options?.pitch || config.speechPitch,
        voice: options?.voiceId,
        onStart: () => {
          this.speaking = true;
        },
        onDone: () => {
          this.speaking = false;
          this.onDoneCallback?.();
        },
        onStopped: () => {
          this.speaking = false;
        },
        onError: (error) => {
          this.speaking = false;
          this.onErrorCallback?.(error.message || 'Speech synthesis failed');
        },
      });
    } catch (error) {
      this.speaking = false;
      const message = error instanceof Error ? error.message : 'Unknown TTS error';
      this.onErrorCallback?.(message);
    }
  }

  stop(): void {
    if (this.speaking) {
      Speech.stop();
      this.speaking = false;
    }
  }

  pause(): void {
    // expo-speech doesn't support pause, so we stop instead
    Speech.pause();
  }

  resume(): void {
    Speech.resume();
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  async getAvailableVoices(): Promise<Voice[]> {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      return voices.map((voice) => ({
        id: voice.identifier,
        name: voice.name,
        language: voice.language,
        isDefault: false, // expo-speech doesn't provide default info
      }));
    } catch {
      return [];
    }
  }

  onStart(callback: TTSEventCallback): void {
    this.onStartCallback = callback;
  }

  onDone(callback: TTSEventCallback): void {
    this.onDoneCallback = callback;
  }

  onError(callback: TTSErrorCallback): void {
    this.onErrorCallback = callback;
  }

  cleanup(): void {
    this.stop();
    this.onStartCallback = null;
    this.onDoneCallback = null;
    this.onErrorCallback = null;
  }
}
