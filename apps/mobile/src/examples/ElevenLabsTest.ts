import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Minimal Working Example for ElevenLabs STT using the SDK.
 * This script fetches a sample audio file and transcribes it using scribe_v2.
 */
export async function runElevenLabsSDKTest() {
  const apiKey = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    console.error("EXPO_PUBLIC_ELEVENLABS_API_KEY is not set in .env");
    return;
  }

  console.log("Starting ElevenLabs SDK Test...");
  const elevenlabs = new ElevenLabsClient({ apiKey });

  try {
    console.log("Fetching sample audio...");
    const response = await fetch(
      "https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3"
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([arrayBuffer], { type: "audio/mp3" });

    // Note: The SDK expects a File or Blob for the 'file' parameter
    // In React Native, we sometimes need to handle this differently, but for an MWE
    // using the provided logic:
    console.log("Sending to ElevenLabs STT (scribe_v2)...");
    const transcription = await elevenlabs.speechToText.convert({
      file: audioBlob,
      modelId: "scribe_v2",
      tagAudioEvents: true,
      languageCode: "eng",
      diarize: true,
    });

    console.log("Transcription result:");
    console.log(JSON.stringify(transcription, null, 2));
    return transcription;
  } catch (error) {
    console.error("ElevenLabs SDK Test failed:", error);
    throw error;
  }
}
