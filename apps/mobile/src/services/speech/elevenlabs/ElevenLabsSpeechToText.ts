/**
 * ElevenLabs Speech-to-Text Service
 * 
 * Uses ElevenLabs API for cloud-based speech recognition.
 * Streams audio from microphone to backend, which forwards to ElevenLabs.
 * Requires API key (proxied through backend for security).
 */

import { Audio } from 'expo-av';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';
import { SPEECH_CONFIG, API_URL } from '../../../config';

export class ElevenLabsSpeechToText implements ISpeechToTextService {
  private recording: Audio.Recording | null = null;
  private isRecording: boolean = false;
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;

  constructor() {
    this.setupAudio();
  }

  private async setupAudio(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
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
    // Check if backend speech endpoint is reachable
    try {
      const response = await fetch(`${API_URL}/speech/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return true; // Assume available
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        return false;
      }

      // Additional Android-specific permission
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'Jarvis needs access to your microphone for voice input.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      return true;
    } catch {
      return false;
    }
  }

  async startListening(options?: STTOptions): Promise<void> {
    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      this.errorCallback?.('Microphone permission denied.');
      return;
    }

    try {
      // Create a new recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      this.recording = recording;
      this.isRecording = true;

      // Show "Listening..." indicator via partial result
      this.partialResultCallback?.('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start recording';
      this.errorCallback?.(message);
    }
  }

  async stopListening(): Promise<void> {
    if (!this.recording || !this.isRecording) {
      return;
    }

    try {
      this.isRecording = false;

      // Stop and unload the recording
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      this.recording = null;

      if (!uri) {
        this.errorCallback?.('No audio recorded.');
        return;
      }

      // Send audio to backend for transcription
      await this.transcribeAudio(uri);
    } catch (error) {
      this.isRecording = false;
      this.recording = null;
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      this.errorCallback?.(message);
    }
  }

  private async transcribeAudio(audioUri: string): Promise<void> {
    try {
      // Create form data with audio file
      const formData = new FormData();
      
      // Get file info for the upload
      const filename = audioUri.split('/').pop() || 'audio.m4a';
      
      formData.append('audio', {
        uri: audioUri,
        type: 'audio/m4a',
        name: filename,
      } as any);

      formData.append('language', SPEECH_CONFIG.native.language);

      // Send to backend for transcription
      const response = await fetch(`${SPEECH_CONFIG.elevenLabs.apiEndpoint}/stt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Transcription failed: ${response.status}`);
      }

      const data = await response.json();
      const transcription = data.text || '';

      if (transcription) {
        this.finalResultCallback?.(transcription);
      } else {
        this.errorCallback?.('No speech detected.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed';
      this.errorCallback?.(message);
    }
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

  cleanup(): void {
    if (this.recording) {
      this.recording.stopAndUnloadAsync().catch(() => {});
      this.recording = null;
    }
    this.isRecording = false;
    // Keep callbacks intact for singleton reuse
  }

  ensureInitialized(): void {
    // ElevenLabs service doesn't need re-initialization
    // Audio setup is idempotent
    this.setupAudio();
  }
}
