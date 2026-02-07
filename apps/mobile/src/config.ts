// API Configuration
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:3000/ws';

// Demo Mode - set to true for standalone demo without backend
// When enabled, the app bypasses authentication and uses mock AI responses
export const DEMO_MODE = true;

// Speech Configuration
// Toggle between 'native' (device-native, free) and 'elevenlabs' (cloud, high-quality)
export type SpeechProvider = 'native' | 'elevenlabs';

export const SPEECH_CONFIG = {
  // Current speech provider - change this to switch between implementations
  provider: 'elevenlabs' as SpeechProvider,

  // Native provider settings
  native: {
    // Language for speech recognition (BCP-47 format)
    language: 'en-US',
    // TTS speech rate (0.5 - 2.0, where 1.0 is normal)
    speechRate: 1.0,
    // TTS pitch (0.5 - 2.0, where 1.0 is normal)
    speechPitch: 1.0,
  },

  // ElevenLabs provider settings (used when provider === 'elevenlabs')
  elevenLabs: {
    // Default voice ID - get from ElevenLabs dashboard
    defaultVoiceId: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || '',
    // TTS model to use
    model: 'eleven_multilingual_v2',
    // API endpoint (proxied through backend for security)
    apiEndpoint: `${API_URL}/speech`,
  },

  // Auto-play TTS when assistant responds
  autoPlayResponses: true,
} as const;
