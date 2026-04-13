import { writeFile, mkdir } from "fs/promises";
import { exec } from "child_process";
import util from "util";
import path from "path";
import { randomUUID } from "crypto";

const execPromise = util.promisify(exec);

// Google Cloud TTS REST endpoint — works with a plain API key (no OAuth required)
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

// Voice config: Studio voice for authoritative safety/training narration
const GOOGLE_TTS_VOICE = {
  languageCode: "en-US",
  name: "en-US-Neural2-D", // Deep, authoritative male voice — suits safety training
};

export interface NarrationScene {
  shot_number?: number;
  scene_number: number;
  voiceover_text: string;
  tone?: string;
  pace?: string;
}

/**
 * Synthesize one text fragment via Google Cloud TTS REST API.
 * Returns the MP3 buffer on success, throws on failure.
 */
async function googleTts(text: string): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set");

  const body = {
    input: { text },
    voice: GOOGLE_TTS_VOICE,
    audioConfig: { audioEncoding: "MP3" },
  };

  const res = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Google TTS API error ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("Google TTS returned empty audioContent");

  return Buffer.from(json.audioContent, "base64");
}

/**
 * Generate 1 second of silent audio via ffmpeg as a last-resort fallback.
 * Ensures the assembly pipeline still runs with at least video tracks intact.
 */
async function generateSilence(outputPath: string): Promise<void> {
  await execPromise(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -q:a 9 -acodec libmp3lame "${outputPath}"`
  );
}

export async function generateNarrationAudio(
  scenes: NarrationScene[],
  jobId: string
): Promise<(string | null)[]> {
  const audioDir = path.resolve(`./output/${jobId}/audio`);
  await mkdir(audioDir, { recursive: true });

  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      const text = scene.voiceover_text?.trim();
      if (!text) return null;

      const index = scene.shot_number ?? scene.scene_number;
      const filename = `shot_${index}_${randomUUID()}.mp3`;
      const filepath = path.join(audioDir, filename);

      // Primary: Google Cloud TTS
      try {
        const buffer = await googleTts(text);
        await writeFile(filepath, buffer);
        console.log(`[tts] shot ${index} → ${filename} (Google TTS)`);
        return `/output/${jobId}/audio/${filename}`;
      } catch (googleErr) {
        console.warn(`[tts] shot ${index}: Google TTS failed — ${(googleErr as Error).message}`);
      }

      // Fallback: ffmpeg silence (1s) — keeps assembly pipeline intact
      try {
        await generateSilence(filepath);
        console.warn(`[tts] shot ${index} → ${filename} (silence fallback — no audio API available)`);
        return `/output/${jobId}/audio/${filename}`;
      } catch (silenceErr) {
        console.error(`[tts] shot ${index}: silence fallback also failed — ${(silenceErr as Error).message}`);
        return null;
      }
    })
  );

  // Preserve index positions: null for failed/empty entries
  return results.map((r) =>
    r.status === "fulfilled" && r.value !== null ? r.value : null
  ) as (string | null)[];
}
