/**
 * Speech API Routes
 * 
 * Provides endpoints for ElevenLabs TTS and STT proxying.
 * These endpoints hide the API key from the mobile app.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { elevenLabsAdapter } from '../adapters/speech/ElevenLabsAdapter.js';

interface TTSRequestBody {
  text: string;
  voiceId: string;
  model?: string;
}

/**
 * Parse JSON body from request
 */
async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, data: unknown, status: number = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, message: string, status: number = 500): void {
  sendJson(res, { error: message }, status);
}

/**
 * Handle speech API routes
 * Returns true if the route was handled, false otherwise
 */
export async function handleSpeechRoutes(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || '';

  // Health check endpoint
  if (url === '/api/speech/health' && method === 'GET') {
    sendJson(res, {
      status: 'ok',
      configured: elevenLabsAdapter.isConfigured(),
    });
    return true;
  }

  // Get available voices
  if (url === '/api/speech/voices' && method === 'GET') {
    try {
      const voices = await elevenLabsAdapter.getVoices();
      sendJson(res, { voices });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get voices';
      sendError(res, message);
    }
    return true;
  }

  // Text-to-Speech endpoint
  if (url === '/api/speech/tts' && method === 'POST') {
    try {
      const body = await parseJsonBody<TTSRequestBody>(req);

      if (!body.text) {
        sendError(res, 'Missing required field: text', 400);
        return true;
      }

      if (!body.voiceId) {
        sendError(res, 'Missing required field: voiceId', 400);
        return true;
      }

      const audioBuffer = await elevenLabsAdapter.textToSpeech({
        text: body.text,
        voiceId: body.voiceId,
        model: body.model,
      });

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
      });
      res.end(audioBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TTS failed';
      sendError(res, message);
    }
    return true;
  }

  // Speech-to-Text endpoint
  if (url === '/api/speech/stt' && method === 'POST') {
    try {
      // For STT, we need to handle multipart form data
      // This is a simplified version - in production, use a proper multipart parser
      const chunks: Buffer[] = [];
      
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve());
        req.on('error', reject);
      });

      const audioBuffer = Buffer.concat(chunks);
      
      if (audioBuffer.length === 0) {
        sendError(res, 'No audio data received', 400);
        return true;
      }

      const result = await elevenLabsAdapter.speechToText(audioBuffer);
      sendJson(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'STT failed';
      sendError(res, message);
    }
    return true;
  }

  // Route not handled
  return false;
}
