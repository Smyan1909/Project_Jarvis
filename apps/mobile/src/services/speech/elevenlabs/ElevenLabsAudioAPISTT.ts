/**
 * ElevenLabs Streaming Speech-to-Text Service using react-native-audio-api
 * 
 * Uses AudioRecorder from react-native-audio-api for raw PCM audio streaming,
 * which is then sent to ElevenLabs WebSocket for real-time transcription.
 */

import { AudioRecorder, AudioManager, AudioContext, AudioBuffer } from 'react-native-audio-api';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// Audio configuration
const DEVICE_SAMPLE_RATE = 48000;      // Native Android sample rate
const ELEVENLABS_SAMPLE_RATE = 16000;  // What ElevenLabs expects
const BUFFER_LENGTH = 48000;           // 1 second at 48kHz (10x larger buffer)
const DOWNSAMPLE_RATIO = DEVICE_SAMPLE_RATE / ELEVENLABS_SAMPLE_RATE; // 3

export class ElevenLabsAudioAPISTT implements ISpeechToTextService {
  private audioRecorder: AudioRecorder | null = null;
  private ws: WebSocket | null = null;
  private apiKey: string;
  private isRecording: boolean = false;
  
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;
  
  private accumulatedText: string = '';
  
  // Debug: Store recorded audio chunks for playback
  private recordedChunks: Float32Array[] = [];
  private audioContext: AudioContext | null = null;

  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
    
    // Debug: Test PCM conversion with known values at startup
    this.testPCMConversion();
  }

  /**
   * Debug: Test PCM16 conversion with known values to verify correctness
   */
  private testPCMConversion(): void {
    console.log('=== PCM Conversion Test ===');
    
    // Test values: float -> expected PCM16 -> expected little-endian bytes
    const testCases = [
      { float: 0.0, expectedPCM: 0, expectedBytes: [0x00, 0x00] },
      { float: 1.0, expectedPCM: 32767, expectedBytes: [0xFF, 0x7F] },
      { float: -1.0, expectedPCM: -32768, expectedBytes: [0x00, 0x80] },
      { float: 0.5, expectedPCM: 16383, expectedBytes: [0xFF, 0x3F] },
      { float: -0.5, expectedPCM: -16384, expectedBytes: [0x00, 0xC0] },
    ];
    
    for (const tc of testCases) {
      const floatArr = new Float32Array([tc.float]);
      const pcm16 = this.floatToPCM16(floatArr);
      const bytes = new Uint8Array(pcm16.buffer);
      
      const pcmMatch = pcm16[0] === tc.expectedPCM;
      const bytesMatch = bytes[0] === tc.expectedBytes[0] && bytes[1] === tc.expectedBytes[1];
      
      console.log(
        `Float ${tc.float.toFixed(1)} -> PCM ${pcm16[0]} (expect ${tc.expectedPCM}) ${pcmMatch ? '✓' : '✗'} | ` +
        `Bytes [${bytes[0]}, ${bytes[1]}] (expect [${tc.expectedBytes[0]}, ${tc.expectedBytes[1]}]) ${bytesMatch ? '✓' : '✗'}`
      );
    }
    
    console.log('=== End PCM Test ===');
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const result = await AudioManager.requestRecordingPermissions();
      return result === 'Granted';
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
            this.partialResultCallback?.(this.accumulatedText + message.text);
          }
          break;
          
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
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
          
        case 'commit_throttled':
          // This is not an error, just a notification that commit was throttled
          console.log('Commit throttled:', message.error);
          break;
          
        default:
          console.log('Unknown message type:', message.message_type, message);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Convert Float32Array audio data to 16-bit PCM Int16Array
   */
  private floatToPCM16(floatData: Float32Array): Int16Array {
    const pcm16 = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      const s = Math.max(-1, Math.min(1, floatData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Downsample audio from device sample rate (48kHz) to ElevenLabs rate (16kHz)
   * Simple decimation - takes every Nth sample where N = DOWNSAMPLE_RATIO
   */
  private downsample(audioData: Float32Array): Float32Array {
    const newLength = Math.floor(audioData.length / DOWNSAMPLE_RATIO);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      result[i] = audioData[Math.floor(i * DOWNSAMPLE_RATIO)];
    }
    return result;
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
      this.recordedChunks = [];
      
      // Configure audio session for both recording and playback
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: [],
      });
      
      const sessionActive = await AudioManager.setAudioSessionActivity(true);
      if (!sessionActive) {
        this.errorCallback?.('Could not activate audio session');
        return;
      }
      
      // Get single-use token and connect WebSocket
      console.log('Fetching single-use token...');
      const token = await this.fetchSingleUseToken();
      console.log('Got single-use token for realtime STT');
      
      await this.connectWebSocket(token);
      
      // Create audio recorder
      this.audioRecorder = new AudioRecorder();
      
      // Set up error handler
      this.audioRecorder.onError((error) => {
        console.error('AudioRecorder error:', error.message);
        this.errorCallback?.(error.message);
      });
      
      // Configure audio callback at device native rate (48kHz)
      // We'll downsample to 16kHz before sending to ElevenLabs
      this.audioRecorder.onAudioReady(
        {
          sampleRate: DEVICE_SAMPLE_RATE,
          bufferLength: BUFFER_LENGTH,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
          }
          
          try {
            // Get raw float audio data from buffer (48kHz)
            const floatData48k = buffer.getChannelData(0);
            
            // Debug: Store a copy of the 48kHz float data for playback
            this.recordedChunks.push(new Float32Array(floatData48k));
            
            // Downsample from 48kHz to 16kHz for ElevenLabs
            const floatData16k = this.downsample(floatData48k);
            
            // Debug: Log sample counts
            console.log(`Audio: ${floatData48k.length} samples @ 48kHz -> ${floatData16k.length} samples @ 16kHz`);
            
            // Convert to 16-bit PCM
            const pcm16 = this.floatToPCM16(floatData16k);
            
            // Convert to base64
            const base64Audio = this.arrayBufferToBase64(pcm16.buffer);
            
            console.log(`Sending audio chunk: ${pcm16.byteLength} bytes to ElevenLabs`);
            
            // Send to ElevenLabs WebSocket
            const message = {
              message_type: 'input_audio_chunk',
              audio_base_64: base64Audio,
              commit: false,
              sample_rate: ELEVENLABS_SAMPLE_RATE,
            };
            
            this.ws.send(JSON.stringify(message));
          } catch (error) {
            console.error('Error processing audio chunk:', error);
          }
        }
      );
      
      // Start recording
      this.isRecording = true;
      const result = this.audioRecorder.start();
      
      if (result.status === 'error') {
        this.errorCallback?.(result.message || 'Failed to start recording');
        this.cleanup();
        return;
      }
      
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
      
      // Stop audio recorder
      if (this.audioRecorder) {
        this.audioRecorder.clearOnAudioReady();
        this.audioRecorder.stop();
        this.audioRecorder = null;
      }
      
      // Deactivate audio session
      AudioManager.setAudioSessionActivity(false);
      
      // Send final commit and close WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send an empty commit to finalize
        const message = {
          message_type: 'input_audio_chunk',
          audio_base_64: '',
          commit: true,
          sample_rate: ELEVENLABS_SAMPLE_RATE,
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
        }, 500);
      }
      
      console.log('Recording stopped');
      
      // Debug: Play back the recorded audio
      await this.playbackRecordedAudio();
      
    } catch (error) {
      this.errorCallback?.(error instanceof Error ? error.message : 'Failed to stop recording');
    }
  }

  /**
   * Debug: Play back the recorded audio chunks to verify capture
   */
  private async playbackRecordedAudio(): Promise<void> {
    if (this.recordedChunks.length === 0) {
      console.log('No audio chunks to play back');
      return;
    }

    try {
      console.log(`Playing back ${this.recordedChunks.length} audio chunks...`);
      
      // Calculate total length (recorded at 48kHz)
      const totalLength = this.recordedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const durationSecs = totalLength / DEVICE_SAMPLE_RATE;
      console.log(`Total samples: ${totalLength}, duration: ${durationSecs.toFixed(2)}s @ ${DEVICE_SAMPLE_RATE}Hz`);
      
      // Create audio context at device sample rate (48kHz)
      this.audioContext = new AudioContext({ sampleRate: DEVICE_SAMPLE_RATE });
      const contextSampleRate = this.audioContext.sampleRate;
      console.log(`AudioContext sample rate: ${contextSampleRate}Hz`);
      
      // Create a buffer at the device sample rate (48kHz)
      const audioBuffer = this.audioContext.createBuffer(1, totalLength, DEVICE_SAMPLE_RATE);
      const channelData = audioBuffer.getChannelData(0);
      
      // Copy all chunks into the buffer
      let offset = 0;
      for (const chunk of this.recordedChunks) {
        channelData.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Create a buffer source node and play
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      console.log('Starting playback...');
      source.start();
      
      // Clean up after playback
      setTimeout(() => {
        console.log('Playback finished');
        if (this.audioContext) {
          this.audioContext.close();
          this.audioContext = null;
        }
      }, durationSecs * 1000 + 500);
      
    } catch (error) {
      console.error('Error playing back audio:', error);
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
    // Stop audio recorder
    if (this.audioRecorder) {
      try {
        this.audioRecorder.clearOnAudioReady();
        this.audioRecorder.clearOnError();
        this.audioRecorder.stop();
      } catch {
        // Ignore cleanup errors
      }
      this.audioRecorder = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Deactivate audio session
    AudioManager.setAudioSessionActivity(false);
    
    this.isRecording = false;
    this.accumulatedText = '';
    this.recordedChunks = [];
  }
}
