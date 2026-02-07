/**
 * Speech Service Types
 * 
 * Shared interfaces for speech-to-text and text-to-speech services.
 * Both native (device) and cloud (ElevenLabs) implementations conform to these interfaces.
 */

// Speech-to-Text Options
export interface STTOptions {
  /** Language code in BCP-47 format (e.g., 'en-US', 'sv-SE') */
  language?: string;
  /** Keep listening until explicitly stopped */
  continuous?: boolean;
  /** Provide partial results as user speaks */
  interimResults?: boolean;
}

// Text-to-Speech Options
export interface TTSOptions {
  /** Voice identifier (provider-specific) */
  voiceId?: string;
  /** Speech rate: 0.5 (slow) to 2.0 (fast), default 1.0 */
  rate?: number;
  /** Speech pitch: 0.5 (low) to 2.0 (high), default 1.0 */
  pitch?: number;
  /** Language code for native TTS */
  language?: string;
}

// Voice information
export interface Voice {
  /** Unique identifier for the voice */
  id: string;
  /** Display name */
  name: string;
  /** Language code */
  language: string;
  /** Whether this is the default voice */
  isDefault?: boolean;
}

// Callback types
export type STTResultCallback = (text: string) => void;
export type STTErrorCallback = (error: string) => void;
export type TTSEventCallback = () => void;
export type TTSErrorCallback = (error: string) => void;

/**
 * Speech-to-Text Service Interface
 * 
 * Implementations:
 * - NativeSpeechToText: Uses device's built-in speech recognition
 * - ElevenLabsSpeechToText: Uses ElevenLabs cloud API
 */
export interface ISpeechToTextService {
  /** Check if speech recognition is available on this device */
  isAvailable(): Promise<boolean>;

  /** Request microphone permission */
  requestPermission(): Promise<boolean>;

  /** Start listening for speech */
  startListening(options?: STTOptions): Promise<void>;

  /** Stop listening and finalize transcription */
  stopListening(): Promise<void>;

  /** Register callback for partial/interim results */
  onPartialResult(callback: STTResultCallback): void;

  /** Register callback for final result */
  onFinalResult(callback: STTResultCallback): void;

  /** Register callback for errors */
  onError(callback: STTErrorCallback): void;

  /** Clean up resources and listeners */
  cleanup(): void;

  /** Ensure service is initialized (for singleton reuse) */
  ensureInitialized?(): void;
}

/**
 * Text-to-Speech Service Interface
 * 
 * Implementations:
 * - NativeTextToSpeech: Uses device's built-in TTS engine
 * - ElevenLabsTextToSpeech: Uses ElevenLabs cloud API for high-quality voices
 */
export interface ITextToSpeechService {
  /** Check if TTS is available */
  isAvailable(): Promise<boolean>;

  /** Speak the given text */
  speak(text: string, options?: TTSOptions): Promise<void>;

  /** Stop any ongoing speech */
  stop(): void;

  /** Pause speech (if supported) */
  pause(): void;

  /** Resume paused speech (if supported) */
  resume(): void;

  /** Check if currently speaking */
  isSpeaking(): boolean;

  /** Get list of available voices */
  getAvailableVoices(): Promise<Voice[]>;

  /** Register callback for when speech starts */
  onStart(callback: TTSEventCallback): void;

  /** Register callback for when speech completes */
  onDone(callback: TTSEventCallback): void;

  /** Register callback for errors */
  onError(callback: TTSErrorCallback): void;

  /** Clean up resources */
  cleanup(): void;
}

/**
 * Combined speech services
 */
export interface SpeechServices {
  stt: ISpeechToTextService;
  tts: ITextToSpeechService;
}
