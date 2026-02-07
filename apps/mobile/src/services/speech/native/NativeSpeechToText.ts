/**
 * Native Speech-to-Text Service
 * 
 * Uses expo-speech-recognition for device-native speech recognition.
 * Requires a development build (doesn't work in Expo Go).
 * Free and unlimited usage.
 */

import {
  ExpoSpeechRecognitionModule,
  addSpeechRecognitionListener,
  type ExpoSpeechRecognitionNativeEventMap,
} from 'expo-speech-recognition';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  ISpeechToTextService,
  STTOptions,
  STTResultCallback,
  STTErrorCallback,
} from '../types';
import { SPEECH_CONFIG } from '../../../config';

type SpeechSubscription = ReturnType<typeof addSpeechRecognitionListener>;

export class NativeSpeechToText implements ISpeechToTextService {
  private isListeningState: boolean = false;
  private partialResultCallback: STTResultCallback | null = null;
  private finalResultCallback: STTResultCallback | null = null;
  private errorCallback: STTErrorCallback | null = null;
  private lastResult: string = '';
  private listenersInitialized: boolean = false;
  
  // Event subscriptions
  private subscriptions: SpeechSubscription[] = [];

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Avoid re-registering if already set up
    if (this.listenersInitialized) {
      console.log('[STT] Listeners already initialized, skipping');
      return;
    }
    
    console.log('[STT] Setting up expo-speech-recognition listeners');
    
    // Listen for speech start
    this.subscriptions.push(
      addSpeechRecognitionListener('start', () => {
        console.log('[STT] Speech started');
        this.isListeningState = true;
      })
    );
    
    // Listen for speech end
    this.subscriptions.push(
      addSpeechRecognitionListener('end', () => {
        console.log('[STT] Speech ended, lastResult:', this.lastResult);
        this.isListeningState = false;
        // Deliver final result if we have one
        if (this.lastResult) {
          console.log('[STT] Delivering final result, callback exists:', !!this.finalResultCallback);
          this.finalResultCallback?.(this.lastResult);
        }
      })
    );
    
    // Listen for results (both partial and final)
    this.subscriptions.push(
      addSpeechRecognitionListener('result', (event) => {
        console.log('[STT] Result event:', event);
        const results = event.results;
        if (results && results.length > 0) {
          const result = results[0];
          const transcript = result?.transcript || '';
          const isFinal = result?.isFinal || false;
          
          console.log('[STT] Transcript:', transcript, 'isFinal:', isFinal);
          
          this.lastResult = transcript;
          
          if (isFinal) {
            console.log('[STT] Final result received');
            this.finalResultCallback?.(transcript);
          } else {
            console.log('[STT] Partial result received');
            this.partialResultCallback?.(transcript);
          }
        }
      })
    );
    
    // Listen for errors
    this.subscriptions.push(
      addSpeechRecognitionListener('error', (event) => {
        console.log('[STT] Speech error:', event);
        this.isListeningState = false;
        const errorMessage = this.getErrorMessage(event.error, event.message);
        this.errorCallback?.(errorMessage);
      })
    );
    
    this.listenersInitialized = true;
  }

  /**
   * Ensure the service is initialized and ready to use.
   * Call this when re-using the singleton after potential cleanup.
   */
  ensureInitialized(): void {
    console.log('[STT] ensureInitialized called, listenersInitialized:', this.listenersInitialized);
    if (!this.listenersInitialized) {
      this.setupListeners();
    }
  }

  private getErrorMessage(code?: string, message?: string): string {
    // expo-speech-recognition error codes
    switch (code) {
      case 'network':
        return 'Network error. Check your connection.';
      case 'audio':
        return 'Audio recording error.';
      case 'server':
        return 'Server error. Please try again.';
      case 'client':
        return 'Client error.';
      case 'speech-timeout':
      case 'no-speech':
        return 'No speech detected. Please try again.';
      case 'no-match':
        return 'No speech match found.';
      case 'busy':
        return 'Speech recognizer is busy.';
      case 'not-allowed':
      case 'permission':
        return 'Microphone permission denied.';
      case 'service-not-allowed':
        return 'Speech recognition service not available.';
      case 'language-not-supported':
        return 'Language not supported.';
      default:
        return message || 'Speech recognition error.';
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const status = ExpoSpeechRecognitionModule.getStateSync();
      console.log('[STT] Speech recognition state:', status);
      
      // Check if recognition is available
      const available = status !== 'inactive' || true; // Most devices support it
      console.log('[STT] isAvailable:', available);
      return true; // Let startListening handle actual errors
    } catch (error) {
      console.log('[STT] isAvailable() threw error:', error);
      return true; // Still return true - let startListening handle errors
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      // Use expo-speech-recognition's permission request
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      console.log('[STT] Permission result:', result);
      
      if (result.granted) {
        return true;
      }
      
      // Fallback to Android's permission system
      if (Platform.OS === 'android') {
        const alreadyGranted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        
        if (alreadyGranted) {
          return true;
        }
        
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
      
      return result.granted;
    } catch (error) {
      console.log('[STT] Permission request error:', error);
      return false;
    }
  }

  async startListening(options?: STTOptions): Promise<void> {
    console.log('[STT] startListening called');
    this.lastResult = '';
    
    // Ensure listeners are set up
    this.ensureInitialized();
    
    const hasPermission = await this.requestPermission();
    console.log('[STT] Permission check result:', hasPermission);
    if (!hasPermission) {
      this.errorCallback?.('Microphone permission denied.');
      return;
    }

    try {
      const language = options?.language || SPEECH_CONFIG.native.language;
      console.log('[STT] Starting speech recognition with language:', language);
      
      // Start speech recognition with expo-speech-recognition
      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults: options?.interimResults !== false,
        continuous: options?.continuous || false,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false, // Allow cloud recognition
        addsPunctuation: true,
      });
      
      console.log('[STT] ExpoSpeechRecognitionModule.start() called');
      this.isListeningState = true;
    } catch (error) {
      console.log('[STT] start() error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('[STT] Error details:', JSON.stringify(error, null, 2));
      
      let message = 'Failed to start speech recognition';
      if (errorMessage.includes('not available') || errorMessage.includes('No Activity')) {
        message = 'Speech recognition not available. Please ensure speech recognition is enabled on your device.';
      } else if (errorMessage.includes('permission')) {
        message = 'Microphone permission denied.';
      } else {
        message = `Speech error: ${errorMessage}`;
      }
      
      this.errorCallback?.(message);
    }
  }

  async stopListening(): Promise<void> {
    console.log('[STT] stopListening called');
    try {
      ExpoSpeechRecognitionModule.stop();
      this.isListeningState = false;
    } catch (error) {
      console.log('[STT] stop() error:', error);
      // Ignore stop errors
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
    console.log('[STT] cleanup called - stopping recognition');
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Ignore errors
    }
    this.isListeningState = false;
    // Keep callbacks and listeners intact for singleton reuse
  }
}
