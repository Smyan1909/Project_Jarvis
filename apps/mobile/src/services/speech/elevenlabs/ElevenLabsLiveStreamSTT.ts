/**
 * ElevenLabs Streaming Speech-to-Text Service using react-native-live-audio-stream
 * 
 * Uses LiveAudioStream for raw PCM audio streaming directly from the microphone,
 * which is then sent to ElevenLabs WebSocket for real-time transcription.
 */

import LiveAudioStream from 'react-native-live-audio-stream';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// Audio configuration - ElevenLabs expects 16kHz 16-bit mono PCM
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BUFFER_SIZE = 4096;  // ~256ms at 16kHz

export class ElevenLabsLiveStreamSTT implements ISpeechToTextService {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private isRecording: boolean = false;
  private isInitialized: boolean = false;
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;
  
  private accumulatedText: string = '';
  private chunkCount: number = 0;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async requestPermission(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      // iOS permissions are handled via Info.plist
      return true;
    } catch {
      return false;
    }
  }

  private buildWebSocketUrl(token: string): string {
    const params = new URLSearchParams({
      model_id: 'scribe_v2_realtime',
      language_code: 'en',
      commit_strategy: 'vad',
      vad_silence_threshold_secs: '1.0',
      vad_threshold: '0.4',
      audio_format: 'pcm_16000',
      token: token,
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

  private async connectWebSocket(token: string): Promise<void> {
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
          if (message.text) {
            console.log('Partial transcript:', message.text);
            this.partialResultCallback?.(this.accumulatedText + message.text);
          }
          break;
          
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          if (message.text) {
            console.log('Committed transcript:', message.text);
            this.accumulatedText += (this.accumulatedText ? ' ' : '') + message.text;
            this.partialResultCallback?.(this.accumulatedText);
          }
          break;
          
        case 'error':
        case 'auth_error':
        case 'quota_exceeded':
        case 'rate_limited':
          console.error('ElevenLabs error:', message.error);
          this.errorCallback?.(message.error || 'Transcription error');
          break;
          
        case 'invalid_request':
          console.error('Invalid request:', message.error || message);
          this.errorCallback?.(message.error || 'Invalid request to ElevenLabs API');
          break;
          
        case 'commit_throttled':
          console.log('Commit throttled:', message.error);
          break;
          
        default:
          console.log('Unknown message type:', message.message_type, message);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private initializeLiveAudioStream(): void {
    if (this.isInitialized) return;
    
    LiveAudioStream.init({
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitsPerSample: BITS_PER_SAMPLE,
      audioSource: 6,  // VOICE_RECOGNITION
      bufferSize: BUFFER_SIZE,
    });
    
    // Set up the data listener
    LiveAudioStream.on('data', (base64Data: string) => {
      // SECURITY: Immediately discard chunks if we are not explicitly recording.
      // This ensures no "zombie" audio chunks are processed or kept in memory after stop.
      if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      this.chunkCount++;
      
      // Calculate bytes from base64 (base64 is ~4/3 larger than binary)
      const estimatedBytes = Math.floor(base64Data.length * 0.75);
      console.log(`Audio chunk #${this.chunkCount}: ~${estimatedBytes} bytes (base64 len: ${base64Data.length})`);
      
      // Send directly to ElevenLabs - it's already base64 encoded PCM!
      const message = {
        message_type: 'input_audio_chunk',
        audio_base_64: base64Data,
        commit: false,
        sample_rate: SAMPLE_RATE,
      };
      
      this.ws.send(JSON.stringify(message));
    });
    
    this.isInitialized = true;
    console.log('LiveAudioStream initialized');
  }

  async startListening(options?: STTOptions): Promise<void> {
    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      this.errorCallback?.('Microphone permission denied.');
      return;
    }

    try {
      // Reset state
      this.accumulatedText = '';
      this.chunkCount = 0;
      
      // Initialize live audio stream (only once)
      this.initializeLiveAudioStream();
      
      // Get single-use token and connect WebSocket
      console.log('Fetching single-use token...');
      const token = await this.fetchSingleUseToken();
      console.log('Got single-use token for realtime STT');
      
      await this.connectWebSocket(token);
      
      // Start recording
      this.isRecording = true;
      LiveAudioStream.start();
      
      console.log('Recording started');
      this.partialResultCallback?.('Listening...');
      
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to start recording');
      this.cleanup();
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isRecording) return;

    try {
      this.isRecording = false;
      
      // Stop recording
      LiveAudioStream.stop();
      console.log(`Recording stopped after ${this.chunkCount} chunks`);
      
      // Send final commit and close WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send an empty commit to finalize
        const message = {
          message_type: 'input_audio_chunk',
          audio_base_64: '',
          commit: true,
          sample_rate: SAMPLE_RATE,
        };
        this.ws.send(JSON.stringify(message));
        
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
        }, 1000);
      }
      
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
    // Stop recording if active
    if (this.isRecording) {
      LiveAudioStream.stop();
      this.isRecording = false;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.accumulatedText = '';
    this.chunkCount = 0;
  }
}
