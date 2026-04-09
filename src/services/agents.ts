import { GoogleGenAI } from "@google/genai";
import { getPrompts } from "./prompts";
import type { VideoUseCase } from "./types";

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

export function createAgents(useCase: VideoUseCase) {
  const prompts = getPrompts(useCase);

  return {
    scriptWriter: async (inputText: string, improvementNotes: string[] = []) => {
      const improvementContext =
        improvementNotes.length > 0
          ? `\n\nPrevious iteration feedback to address:\n${improvementNotes.join("\n")}`
          : "";

      const response = await getClient().models.generateContent({
        model: MODEL,
        contents: `Input: ${inputText}${improvementContext}`,
        config: {
          systemInstruction: prompts.scriptWriter,
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
          systemInstruction: prompts.videoDirector,
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
          systemInstruction: prompts.audioAgent,
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
          systemInstruction: prompts.assemblyCoordinator,
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
          systemInstruction: prompts.qualityValidator,
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
}
