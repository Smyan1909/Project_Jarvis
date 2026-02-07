/**
 * ElevenLabs REST-based Speech-to-Text Service
 * 
 * Uses direct REST API calls instead of the SDK to avoid Node.js dependencies.
 * Compatible with React Native / Expo.
 */

import { Audio } from 'expo-av';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export class ElevenLabsRESTSTT implements ISpeechToTextService {
  private recording: Audio.Recording | null = null;
  private isRecording: boolean = false;
  private apiKey: string;
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
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
    return !!this.apiKey;
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

      await this.transcribeWithREST(uri);
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to stop recording');
    }
  }

  private async transcribeWithREST(audioUri: string): Promise<void> {
    try {
      // Fetch the audio file as a blob
      const response = await fetch(audioUri);
      const audioBlob = await response.blob();

      // Create FormData for multipart/form-data request
      const formData = new FormData();
      
      // Append the audio file - React Native FormData accepts blob with name/type
      formData.append('file', {
        uri: audioUri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as unknown as Blob);
      
      formData.append('model_id', 'scribe_v2');
      formData.append('language_code', 'eng');

      console.log('Transcribing with ElevenLabs REST API (scribe_v2)...');
      
      const transcriptionResponse = await fetch(ELEVENLABS_STT_URL, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          // Don't set Content-Type - fetch will set it with boundary for FormData
        },
        body: formData,
      });

      if (!transcriptionResponse.ok) {
        const errorData = await transcriptionResponse.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || `STT request failed: ${transcriptionResponse.status}`);
      }

      const transcription = await transcriptionResponse.json();

      if (transcription && transcription.text) {
        this.finalResultCallback?.(transcription.text);
      } else {
        this.errorCallback?.('No speech detected.');
      }
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'REST Transcription failed');
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
