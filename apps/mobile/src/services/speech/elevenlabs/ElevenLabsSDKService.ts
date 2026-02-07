/**
 * ElevenLabs SDK-based Speech-to-Text Service
 * 
 * Uses the @elevenlabs/elevenlabs-js SDK directly in the frontend.
 * Note: Requires EXPO_PUBLIC_ELEVENLABS_API_KEY in .env
 */

import { Audio } from 'expo-av';
import { Platform, PermissionsAndroid } from 'react-native';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

export class ElevenLabsSDKSTT implements ISpeechToTextService {
  private recording: Audio.Recording | null = null;
  private isRecording: boolean = false;
  private client: ElevenLabsClient;
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;

  constructor() {
    const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
    this.client = new ElevenLabsClient({ apiKey });
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
    } catch (error) {
      console.warn('Audio setup error:', error);
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') return false;

      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
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
      this.isRecording = true;
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      this.recording = recording;
      this.partialResultCallback?.('Listening...');
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to start recording');
    }
  }

  async stopListening(): Promise<void> {
    if (!this.recording || !this.isRecording) return;

    try {
      this.isRecording = false;
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      this.recording = null;

      if (!uri) {
        this.errorCallback?.('No audio recorded.');
        return;
      }

      await this.transcribeWithSDK(uri);
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to stop recording');
    }
  }

  private async transcribeWithSDK(audioUri: string): Promise<void> {
    try {
      // In a real React Native environment, we need to convert the URI to a Blob/File
      const response = await fetch(audioUri);
      const audioBlob = await response.blob();

      console.log('Transcribing with ElevenLabs SDK (scribe_v2)...');
      const transcription = await this.client.speechToText.convert({
        file: audioBlob,
        modelId: "scribe_v2",
        tagAudioEvents: true,
        languageCode: "eng",
        diarize: true,
      });

      if (transcription && transcription.text) {
        this.finalResultCallback?.(transcription.text);
      } else {
        this.errorCallback?.('No speech detected.');
      }
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'SDK Transcription failed');
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
  }
}
