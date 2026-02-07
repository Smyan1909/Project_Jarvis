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
import { SPEECH_CONFIG, API_URL, DEMO_MODE } from '../../../config';

/**
 * Convert Blob to data URI using FileReader.
 * Returns the full data URI (e.g., "data:audio/mpeg;base64,...")
 * which can be passed directly to expo-av Audio.Sound.createAsync.
 */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result); // Full data URI
      } else {
        reject(new Error('FileReader did not return a string'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

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
    // In demo mode, check if we have API key for direct calls
    if (DEMO_MODE) {
      return Boolean(SPEECH_CONFIG.elevenLabs.apiKey);
    }
    
    // Check if backend endpoint is reachable
    try {
      const response = await fetch(`${API_URL}/speech/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      // If backend is not available, check if direct mode is possible
      return Boolean(SPEECH_CONFIG.elevenLabs.apiKey);
    }
  }

  /**
   * Check if backend speech proxy is available
   */
  private async isBackendAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${API_URL}/speech/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Determine if direct ElevenLabs API should be used
   */
  private async shouldUseDirect(): Promise<boolean> {
    // In demo mode, always use direct API
    if (DEMO_MODE) {
      return true;
    }
    
    // Otherwise check if backend is available
    return !(await this.isBackendAvailable());
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

    // Determine if we should use direct ElevenLabs API
    const useDirect = await this.shouldUseDirect();

    // Check API key availability for direct mode
    if (useDirect && !config.apiKey) {
      this.onErrorCallback?.('ElevenLabs API key not configured for direct mode. Please set EXPO_PUBLIC_ELEVENLABS_API_KEY.');
      return;
    }

    try {
      this.speaking = true;
      this.onStartCallback?.();

      console.log('[ElevenLabsTTS] Starting TTS request...', { useDirect, voiceId, textLength: text.length });

      let audioBlob: Blob;

      if (useDirect) {
        // Direct ElevenLabs API call (for demo mode or when backend unavailable)
        const url = `${config.directApiUrl}/text-to-speech/${voiceId}/stream`;
        console.log('[ElevenLabsTTS] Calling direct API:', url);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': config.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: config.model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        });

        console.log('[ElevenLabsTTS] Response status:', response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ElevenLabsTTS] API error response:', errorText);
          let errorMessage = `Direct TTS request failed: ${response.status}`;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.detail?.message || errorData.detail || errorMessage;
          } catch {
            // Use default error message
          }
          throw new Error(errorMessage);
        }

        audioBlob = await response.blob();
        console.log('[ElevenLabsTTS] Received audio blob, size:', audioBlob.size);
      } else {
        // Request audio from backend proxy (which calls ElevenLabs API)
        console.log('[ElevenLabsTTS] Calling backend proxy:', `${config.apiEndpoint}/tts`);
        
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

        console.log('[ElevenLabsTTS] Backend response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `TTS request failed: ${response.status}`);
        }

        audioBlob = await response.blob();
        console.log('[ElevenLabsTTS] Received audio blob from backend, size:', audioBlob.size);
      }

      // Convert blob to data URI using FileReader
      // (React Native doesn't support URL.createObjectURL or Blob.arrayBuffer())
      console.log('[ElevenLabsTTS] Converting blob to data URI...');
      const dataUri = await blobToDataUri(audioBlob);
      console.log('[ElevenLabsTTS] Data URI length:', dataUri.length);

      // Create and play sound directly from data URI (no file writing needed)
      console.log('[ElevenLabsTTS] Creating sound from data URI...');
      const { sound } = await Audio.Sound.createAsync(
        { uri: dataUri },
        { shouldPlay: true },
        this.handlePlaybackStatusUpdate.bind(this)
      );

      this.sound = sound;
      console.log('[ElevenLabsTTS] Sound created and playing');
    } catch (error) {
      this.speaking = false;
      const message = error instanceof Error ? error.message : 'ElevenLabs TTS failed';
      console.error('[ElevenLabsTTS] Error:', message, error);
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
