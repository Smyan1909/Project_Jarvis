/**
 * ElevenLabs Streaming Speech-to-Text Service
 * 
 * Uses WebSocket API for real-time transcription with live partial results.
 * Provides low-latency streaming transcription as the user speaks.
 */

import { Audio } from 'expo-av';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// WAV header is 44 bytes - we need to skip this when sending raw PCM
const WAV_HEADER_SIZE = 44;

// Audio recording settings for PCM 16kHz
const RECORDING_OPTIONS = {
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

export class ElevenLabsStreamingSTT implements ISpeechToTextService {
  private recording: Audio.Recording | null = null;
  private isRecording: boolean = false;
  private ws: WebSocket | null = null;
  private apiKey: string;
  private audioStreamInterval: NodeJS.Timeout | null = null;
  private lastAudioPosition: number = 0;
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;
  
  private accumulatedText: string = '';
  private headerSkipped: boolean = false;

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

  private buildWebSocketUrl(token: string): string {
    const params = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      language_code: 'en',
      commit_strategy: 'vad', // Voice Activity Detection for automatic commit
      vad_silence_threshold_secs: '1.0',
      vad_threshold: '0.4',
      audio_format: 'pcm_16000',
      token: token, // Single-use token for authentication
    });
    
    return `${ELEVENLABS_WS_URL}?${params.toString()}`;
  }

  private async fetchSingleUseToken(): Promise<string> {
    const response = await fetch(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail?.message || `Failed to get token: ${response.status}`);
    }
    
    const data = await response.json();
    return data.token;
  }

  private async connectWebSocket(): Promise<void> {
    // Fetch single-use token first
    const token = await this.fetchSingleUseToken();
    console.log('Got single-use token for realtime STT');
    
    return new Promise((resolve, reject) => {
      const url = this.buildWebSocketUrl(token);
      
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('ElevenLabs STT WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.errorCallback?.('WebSocket connection error');
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.ws = null;
      };
    });
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      switch (message.message_type) {
        case 'session_started':
          console.log('STT Session started:', message.session_id);
          break;
          
        case 'partial_transcript':
          // Live partial transcription - update UI immediately
          if (message.text) {
            this.partialResultCallback?.(this.accumulatedText + message.text);
          }
          break;
          
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          // Final committed transcription for this segment
          if (message.text) {
            this.accumulatedText += (this.accumulatedText ? ' ' : '') + message.text;
            this.partialResultCallback?.(this.accumulatedText);
          }
          break;
          
        case 'error':
        case 'auth_error':
        case 'quota_exceeded':
        case 'rate_limited':
          this.errorCallback?.(message.error || 'Transcription error');
          break;
          
        case 'invalid_request':
          console.error('Invalid request:', message.error || message);
          this.errorCallback?.(message.error || 'Invalid request to ElevenLabs API');
          break;
          
        default:
          console.log('Unknown message type:', message.message_type, message);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  async startListening(options?: STTOptions): Promise<void> {
    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      this.errorCallback?.('Microphone permission denied.');
      return;
    }

    try {
      // Reset accumulated text for new session
      this.accumulatedText = '';
      this.lastAudioPosition = 0;
      this.headerSkipped = false;
      
      // Connect WebSocket first
      await this.connectWebSocket();
      
      // Start recording
      this.isRecording = true;
      const { recording } = await Audio.Recording.createAsync(
        RECORDING_OPTIONS,
        this.onRecordingStatusUpdate.bind(this),
        100 // Update every 100ms
      );
      this.recording = recording;
      
      this.partialResultCallback?.('Listening...');
      
      // Start streaming audio chunks to WebSocket
      this.startAudioStreaming();
      
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to start recording');
      this.cleanup();
    }
  }

  private onRecordingStatusUpdate(status: Audio.RecordingStatus): void {
    // This is called periodically during recording
    // We use this to know recording is active
  }

  private startAudioStreaming(): void {
    // Poll for audio data and send to WebSocket
    this.audioStreamInterval = setInterval(async () => {
      if (!this.recording || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const uri = this.recording.getURI();
        if (!uri) return;

        // Read the audio file and get new chunks
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        
        // Determine the start position for reading
        let startPosition = this.lastAudioPosition;
        
        // Skip WAV header on first read (44 bytes)
        if (!this.headerSkipped && arrayBuffer.byteLength > WAV_HEADER_SIZE) {
          startPosition = Math.max(startPosition, WAV_HEADER_SIZE);
          this.headerSkipped = true;
          console.log('Skipped WAV header, starting from byte', startPosition);
        }
        
        // Only send new audio data (from start position to end)
        if (arrayBuffer.byteLength > startPosition) {
          const newData = arrayBuffer.slice(startPosition);
          this.lastAudioPosition = arrayBuffer.byteLength;
          
          // Convert to base64
          const base64Audio = this.arrayBufferToBase64(newData);
          
          console.log(`Sending audio chunk: ${newData.byteLength} bytes`);
          
          // Send audio chunk to WebSocket
          const message = {
            message_type: 'input_audio_chunk',
            audio_base_64: base64Audio,
            commit: false,
            sample_rate: 16000,
          };
          
          this.ws.send(JSON.stringify(message));
        }
      } catch (error) {
        console.warn('Error streaming audio:', error);
      }
    }, 250); // Send chunks every 250ms
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async stopListening(): Promise<void> {
    if (!this.recording || !this.isRecording) return;

    try {
      this.isRecording = false;
      
      // Stop audio streaming interval
      if (this.audioStreamInterval) {
        clearInterval(this.audioStreamInterval);
        this.audioStreamInterval = null;
      }
      
      // Send final commit message
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Get any remaining audio
        const uri = this.recording.getURI();
        if (uri) {
          const response = await fetch(uri);
          const arrayBuffer = await response.arrayBuffer();
          
          // Determine start position (skip header if not already done)
          let startPosition = this.lastAudioPosition;
          if (!this.headerSkipped && arrayBuffer.byteLength > WAV_HEADER_SIZE) {
            startPosition = Math.max(startPosition, WAV_HEADER_SIZE);
            this.headerSkipped = true;
          }
          
          if (arrayBuffer.byteLength > startPosition) {
            const newData = arrayBuffer.slice(startPosition);
            const base64Audio = this.arrayBufferToBase64(newData);
            
            console.log(`Sending final audio chunk: ${newData.byteLength} bytes with commit=true`);
            
            // Send final chunk with commit=true
            const message = {
              message_type: 'input_audio_chunk',
              audio_base_64: base64Audio,
              commit: true,
              sample_rate: 16000,
            };
            
            this.ws.send(JSON.stringify(message));
          }
        }
        
        // Wait a bit for final transcription then close
        setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          
          // Send final accumulated result
          if (this.accumulatedText) {
            this.finalResultCallback?.(this.accumulatedText);
          }
        }, 500);
      }
      
      // Stop recording
      await this.recording.stopAndUnloadAsync();
      this.recording = null;
      
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to stop recording');
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
    // Stop streaming interval
    if (this.audioStreamInterval) {
      clearInterval(this.audioStreamInterval);
      this.audioStreamInterval = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Stop recording
    if (this.recording) {
      this.recording.stopAndUnloadAsync().catch(() => {});
      this.recording = null;
    }
    
    this.isRecording = false;
    this.accumulatedText = '';
    this.lastAudioPosition = 0;
    this.headerSkipped = false;
  }
}
