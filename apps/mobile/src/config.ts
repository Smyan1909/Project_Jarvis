// API Configuration
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// Socket.io connects to base URL (not /api path)
export const SOCKET_URL = API_URL.replace('/api', '');

// Legacy WebSocket URL - use SOCKET_URL instead for Socket.io
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL || SOCKET_URL;

// Demo Mode - set EXPO_PUBLIC_DEMO_MODE=false to connect to real backend
// Default: true (uses mock responses, no backend required)
// When enabled, the app bypasses authentication and uses mock AI responses
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE !== 'false';

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
    // API key for direct ElevenLabs calls (when backend unavailable)
    apiKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '',
    // Default voice ID - get from ElevenLabs dashboard
    // Fallback to "Sarah" voice if not configured
    defaultVoiceId: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
    // TTS model to use
    model: 'eleven_multilingual_v2',
    // API endpoint (proxied through backend for security)
    apiEndpoint: `${API_URL}/speech`,
    // Direct ElevenLabs API URL (for demo/offline mode)
    directApiUrl: 'https://api.elevenlabs.io/v1',
  },

  // Auto-play TTS when assistant responds
  autoPlayResponses: true,
} as const;
