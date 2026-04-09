import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash";

// Singleton client — created once, reused across all agent calls
let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!_client) {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error("GOOGLE_API_KEY environment variable is not set");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
  return _client;
}

function parseJson(text: string | undefined, fallback: unknown = {}): any {
  try {
    return JSON.parse(text || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

export const agents = {
  scriptWriter: async (sopText: string, improvementNotes: string[] = []) => {
    const improvementContext =
      improvementNotes.length > 0
        ? `\n\nPrevious iteration feedback to address:\n${improvementNotes.join("\n")}`
        : "";

    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `SOP: ${sopText}${improvementContext}`,
      config: {
        systemInstruction: `You are the SOP Parser & Script Writer. Extract the safety SOP details and write a scene-by-scene training video script.
Each scene will be shot as one or more AI-generated video clips, each clip maximum 7 seconds. Keep scenes short and focused — each scene should cover exactly one safety step or concept.
Return JSON with structure: { title: string, scenes: [{ scene_number: number, title: string, description: string, key_points: string[], duration_seconds: number }] }`,
        responseMimeType: "application/json",
      },
    });
    return parseJson(response.text, { scenes: [] });
  },

  videoDirector: async (script: any) => {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `Script: ${JSON.stringify(script)}`,
      config: {
        systemInstruction: `You are the Video Director. Produce detailed shot descriptions and AI video generation prompts for each scene.
CONSTRAINT: Each shot will be generated as a single AI video clip with a maximum duration of 7 seconds. Keep each shot focused on one clear visual action.
Return JSON with structure: { shots: [{ scene_number: number, shot_description: string, video_prompt: string, duration_seconds: number, text_overlays: string[] }] }
The video_prompt must be a vivid, self-contained visual description suitable for any AI video generator — no references to specific models or tools. Focus on camera angle, subject, action, lighting, and environment.`,
        responseMimeType: "application/json",
      },
    });
    return parseJson(response.text, { shots: [] });
  },

  audioAgent: async (script: any, shot_list: any) => {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `Script: ${JSON.stringify(script)}\n\nShot list: ${JSON.stringify(shot_list)}`,
      config: {
        systemInstruction: `You are the Voiceover & Audio Director. Write narration for each individual shot in the shot list — one narration entry per shot.
CRITICAL CONSTRAINT: Each video clip is maximum 7 seconds long. Each narration MUST be spoken in 6 seconds or less — roughly 12-15 words maximum. Be concise and punchy.
Return JSON with structure: { narration: [{ shot_number: number, scene_number: number, voiceover_text: string, tone: string, pace: string }], music_cues: [{ scene_number: number, style: string, mood: string }] }
The shot_number must match the index (1-based) of the shot in the shot list. Write exactly one narration entry per shot.`,
        responseMimeType: "application/json",
      },
    });
    return parseJson(response.text, { narration: [], music_cues: [] });
  },

  assemblyCoordinator: async (data: {
    script: any;
    shot_list: any;
    audio_plan: any;
    video_uris: string[];
  }) => {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `Production data: ${JSON.stringify(data)}`,
      config: {
        systemInstruction: `You are the Video Assembly Coordinator. Build a frame-accurate timeline and FFmpeg instructions to combine video clips with voiceover and music.
Return JSON with structure: { timeline: [{ shot: number, start_time: number, end_time: number, clip_uri: string, narration: string }], ffmpeg_commands: string[], output_file: string }`,
        responseMimeType: "application/json",
      },
    });
    return parseJson(response.text, { timeline: [], ffmpeg_commands: [] });
  },

  qualityValidator: async (data: {
    sop: string;
    script: any;
    shot_list: any;
    audio_plan: any;
    assembly_plan: any;
  }) => {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `Validation data: ${JSON.stringify(data)}`,
      config: {
        systemInstruction: `You are the Quality Validator. Score the video production package against the original safety SOP for accuracy, completeness, safety coverage, and production quality.
Return JSON with structure: { overall_score: number (0-100), sop_coverage_score: number, production_quality_score: number, safety_accuracy_score: number, improvement_notes: string[], passed: boolean }`,
        responseMimeType: "application/json",
      },
    });
    return parseJson(response.text, {
      overall_score: 0,
      improvement_notes: [],
      passed: false,
    });
  },
};
