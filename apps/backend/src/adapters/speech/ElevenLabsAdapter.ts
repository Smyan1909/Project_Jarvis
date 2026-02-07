/**
 * ElevenLabs API Adapter
 * 
 * Provides server-side integration with ElevenLabs Speech APIs.
 * API key is stored server-side for security.
 */

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

interface TTSRequest {
  text: string;
  voiceId: string;
  model?: string;
}

interface STTResponse {
  text: string;
  confidence?: number;
}

interface Voice {
  id: string;
  name: string;
  language: string;
}

export class ElevenLabsAdapter {
  private apiKey: string;

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.warn('ELEVENLABS_API_KEY not set. ElevenLabs features will be disabled.');
    }
    this.apiKey = apiKey || '';
  }

  /**
   * Check if the adapter is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Convert text to speech using ElevenLabs API
   * Returns audio as a Buffer (MP3 format by default)
   */
  async textToSpeech(request: TTSRequest): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }

    const { text, voiceId, model = 'eleven_multilingual_v2' } = request;

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs TTS failed: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Convert speech to text using ElevenLabs API
   */
  async speechToText(audioBuffer: Buffer, language: string = 'en'): Promise<STTResponse> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }

    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
    formData.append('audio', audioBlob, 'audio.mp3');
    formData.append('language_code', language);

    const response = await fetch(
      `${ELEVENLABS_API_URL}/speech-to-text`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs STT failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      confidence: data.confidence,
    };
  }

  /**
   * Get available voices from ElevenLabs
   */
  async getVoices(): Promise<Voice[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const response = await fetch(
        `${ELEVENLABS_API_URL}/voices`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': this.apiKey,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.voices || []).map((voice: any) => ({
        id: voice.voice_id,
        name: voice.name,
        language: voice.labels?.language || 'en',
      }));
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const elevenLabsAdapter = new ElevenLabsAdapter();
