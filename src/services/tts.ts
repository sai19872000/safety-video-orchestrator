import OpenAI from "openai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const TTS_MODEL = "tts-1"; // TODO: upgrade to gpt-4o-mini-tts when ready
const TTS_VOICE: OpenAI.Audio.Speech.SpeechCreateParams["voice"] = "onyx"; // deep, authoritative — suits safety training

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface NarrationScene {
  shot_number?: number;
  scene_number: number;
  voiceover_text: string;
  tone?: string;
  pace?: string;
}

export async function generateNarrationAudio(
  scenes: NarrationScene[],
  jobId: string
): Promise<(string | null)[]> {
  const audioDir = path.resolve(`./output/${jobId}/audio`);
  await mkdir(audioDir, { recursive: true });
  const client = getClient();

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      const text = scene.voiceover_text?.trim();
      if (!text) return null;

      const response = await client.audio.speech.create({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      const index = scene.shot_number ?? scene.scene_number;
      const filename = `shot_${index}_${randomUUID()}.mp3`;
      const filepath = path.join(audioDir, filename);
      await writeFile(filepath, buffer);
      console.log(`[tts] shot ${index} → ${filename}`);
      return `/output/${jobId}/audio/${filename}`;
    })
  );

  // Return sparse array: preserve index positions (null for failed/empty entries)
  return results.map((r) => (r.status === "fulfilled" && r.value !== null ? r.value : null)) as (string | null)[];
}
