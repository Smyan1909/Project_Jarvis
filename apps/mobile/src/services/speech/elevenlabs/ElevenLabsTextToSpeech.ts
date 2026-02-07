/**
 * ElevenLabs Text-to-Speech Service
 * 
 * Uses ElevenLabs API for high-quality AI voices.
 * Requires API key (proxied through backend for security).
 * Free tier: ~10-20 minutes/month.
 */

import { Audio, AVPlaybackStatus } from 'expo-av';
import {
  ITextToSpeechService,
  TTSOptions,
  Voice,
  TTSEventCallback,
  TTSErrorCallback,
} from '../types';
import { SPEECH_CONFIG, API_URL } from '../../../config';

export class ElevenLabsTextToSpeech implements ITextToSpeechService {
  private sound: Audio.Sound | null = null;
  private speaking: boolean = false;
  private onStartCallback: TTSEventCallback | null = null;
  private onDoneCallback: TTSEventCallback | null = null;
  private onErrorCallback: TTSErrorCallback | null = null;

  constructor() {
    // Configure audio mode for playback
    this.setupAudio();
  }

  private async setupAudio(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch {
      // Ignore audio setup errors
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if backend endpoint is reachable
    try {
      const response = await fetch(`${API_URL}/speech/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      // If backend is not available, return false
      // In production, this should properly check ElevenLabs availability
      return true; // Assume available, will fail gracefully on actual use
    }
  }

  async speak(text: string, options?: TTSOptions): Promise<void> {
    if (!text.trim()) {
      return;
    }

    // Stop any ongoing speech
    this.stop();

    const config = SPEECH_CONFIG.elevenLabs;
    const voiceId = options?.voiceId || config.defaultVoiceId;

    if (!voiceId) {
      this.onErrorCallback?.('No voice ID configured. Please set EXPO_PUBLIC_ELEVENLABS_VOICE_ID.');
      return;
    }

    try {
      this.speaking = true;
      this.onStartCallback?.();

      // Request audio from backend proxy (which calls ElevenLabs API)
      const response = await fetch(`${config.apiEndpoint}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voiceId,
          model: config.model,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `TTS request failed: ${response.status}`);
      }

      // Get audio blob from response
      const audioBlob = await response.blob();
      const audioUri = URL.createObjectURL(audioBlob);

      // Create and play sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        this.handlePlaybackStatusUpdate.bind(this)
      );

      this.sound = sound;
    } catch (error) {
      this.speaking = false;
      const message = error instanceof Error ? error.message : 'ElevenLabs TTS failed';
      this.onErrorCallback?.(message);
    }
  }

  private handlePlaybackStatusUpdate(status: AVPlaybackStatus): void {
    if (!status.isLoaded) {
      if ('error' in status && status.error) {
        this.speaking = false;
        this.onErrorCallback?.(status.error);
      }
      return;
    }

    if (status.didJustFinish) {
      this.speaking = false;
      this.onDoneCallback?.();
      this.cleanupSound();
    }
  }

  private async cleanupSound(): Promise<void> {
    if (this.sound) {
      try {
        await this.sound.unloadAsync();
      } catch {
        // Ignore cleanup errors
      }
      this.sound = null;
    }
  }

  stop(): void {
    if (this.sound && this.speaking) {
      this.sound.stopAsync().catch(() => {});
      this.speaking = false;
      this.cleanupSound();
    }
  }

  pause(): void {
    if (this.sound && this.speaking) {
      this.sound.pauseAsync().catch(() => {});
    }
  }

  resume(): void {
    if (this.sound) {
      this.sound.playAsync().catch(() => {});
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  async getAvailableVoices(): Promise<Voice[]> {
    // Fetch available voices from backend (which queries ElevenLabs)
    try {
      const response = await fetch(`${SPEECH_CONFIG.elevenLabs.apiEndpoint}/voices`, {
        method: 'GET',
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.voices || [];
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
    this.cleanupSound();
    this.onStartCallback = null;
    this.onDoneCallback = null;
    this.onErrorCallback = null;
  }
}
