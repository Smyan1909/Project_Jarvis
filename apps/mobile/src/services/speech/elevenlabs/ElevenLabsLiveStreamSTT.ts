/**
 * ElevenLabs Streaming Speech-to-Text Service using react-native-live-audio-stream
 * 
 * Uses LiveAudioStream for raw PCM audio streaming directly from the microphone,
 * which is then sent to ElevenLabs WebSocket for real-time transcription.
 * 
 * NOTE: This requires a development build. In Expo Go, the native module is not available.
 */

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

const DEV_BUILD_REQUIRED_MESSAGE = 'Voice recording requires a development build. Please run: npx expo run:android';

// Safely import LiveAudioStream - it may not be available in Expo Go
let LiveAudioStream: any = null;
let nativeModuleAvailable = false;

try {
  // Dynamic require to prevent crash if module is not linked
  LiveAudioStream = require('react-native-live-audio-stream').default;
  // Test if the module is actually functional (not just a stub)
  if (LiveAudioStream && typeof LiveAudioStream.init === 'function') {
    nativeModuleAvailable = true;
    console.log('[ElevenLabsSTT] Native audio module available');
  }
} catch (error) {
  console.warn('[ElevenLabsSTT] Native audio module not available (Expo Go?):', error);
  nativeModuleAvailable = false;
}

export class ElevenLabsLiveStreamSTT implements ISpeechToTextService {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private isRecording: boolean = false;
  private isInitialized: boolean = false;
  private nativeModuleError: boolean = false;
  private isShuttingDown: boolean = false;  // Track shutdown state to ignore spurious errors
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;
  
  private accumulatedText: string = '';
  private chunkCount: number = 0;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
    
    // Check if native module is available
    if (!nativeModuleAvailable) {
      console.warn('[ElevenLabsSTT] Running in limited mode - native audio not available');
      this.nativeModuleError = true;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Must have API key AND native module
    return !!this.apiKey && nativeModuleAvailable && !this.nativeModuleError;
  }

  async requestPermission(): Promise<boolean> {
    if (!nativeModuleAvailable) {
      return false;
    }
    
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
        // Ignore errors during shutdown - these are expected when server closes first
        if (this.isShuttingDown) {
          console.log('WebSocket error during shutdown (ignored):', error);
          return;
        }
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

  private initializeLiveAudioStream(): boolean {
    if (this.isInitialized) return true;
    
    if (!nativeModuleAvailable || !LiveAudioStream) {
      console.error('[ElevenLabsSTT] Cannot initialize - native module not available');
      this.nativeModuleError = true;
      return false;
    }
    
    try {
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
        
        this.ws!.send(JSON.stringify(message));
      });
      
      this.isInitialized = true;
      console.log('LiveAudioStream initialized');
      return true;
    } catch (error) {
      console.error('[ElevenLabsSTT] Failed to initialize LiveAudioStream:', error);
      this.nativeModuleError = true;
      return false;
    }
  }

  async startListening(options?: STTOptions): Promise<void> {
    // Check if native module is available
    if (!nativeModuleAvailable || this.nativeModuleError) {
      this.errorCallback?.(DEV_BUILD_REQUIRED_MESSAGE);
      return;
    }
    
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
      const initialized = this.initializeLiveAudioStream();
      if (!initialized) {
        this.errorCallback?.(DEV_BUILD_REQUIRED_MESSAGE);
        return;
      }
      
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      // Check if it's a native module error
      if (errorMessage.includes('null') || errorMessage.includes('undefined') || errorMessage.includes('not a function')) {
        this.nativeModuleError = true;
        this.errorCallback?.(DEV_BUILD_REQUIRED_MESSAGE);
      } else {
        this.errorCallback?.(errorMessage);
      }
      this.cleanup();
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isRecording) return;

    try {
      this.isRecording = false;
      this.isShuttingDown = true;  // Mark as shutting down to ignore WebSocket errors
      
      // Stop recording (safely)
      if (nativeModuleAvailable && LiveAudioStream) {
        try {
          LiveAudioStream.stop();
        } catch (e) {
          console.warn('[ElevenLabsSTT] Error stopping LiveAudioStream:', e);
        }
      }
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
          // Only close if still open (server may have closed it already)
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          this.ws = null;
          
          // Send final accumulated result
          if (this.accumulatedText) {
            this.finalResultCallback?.(this.accumulatedText);
          }
          
          // Reset shutdown flag
          this.isShuttingDown = false;
        }, 1000);
      } else {
        // WebSocket already closed, just send final result
        if (this.accumulatedText) {
          this.finalResultCallback?.(this.accumulatedText);
        }
        this.isShuttingDown = false;
      }
      
    } catch (error) {
      this.isShuttingDown = false;
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
    this.isShuttingDown = true;  // Prevent error callbacks during cleanup
    
    // Stop recording if active (safely)
    if (this.isRecording && nativeModuleAvailable && LiveAudioStream) {
      try {
        LiveAudioStream.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
      this.isRecording = false;
    }
    
    // Close WebSocket (only if still open)
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
      this.ws = null;
    }
    
    this.accumulatedText = '';
    this.chunkCount = 0;
    this.isShuttingDown = false;
  }
}
