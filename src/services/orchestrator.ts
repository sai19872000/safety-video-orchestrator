import { createAgents } from "./agents";
import { generateVideo } from "./video-provider";
import { generateNarrationAudio } from "./tts";
import { assembleVideo } from "./assembly";
import type { PipelineState, PipelineStatus, VideoUseCase } from "./types";

export type { PipelineState, PipelineStatus };

const MAX_ITERATIONS = 2; // TODO: restore to 3 for production
const VIDEO_CONCURRENCY = 1;

async function generateVideoForShot(prompt: string, jobId: string): Promise<string | null> {
  try {
    return await generateVideo(prompt, jobId);
  } catch (err: any) {
    console.error("Video generation failed for shot:", err?.message ?? err);
    return null;
  }
}

export async function runPipeline(
  jobId: string,
  inputText: string,
  useCase: VideoUseCase,
  onUpdate: (state: PipelineState) => void
): Promise<PipelineState> {
  const agents = createAgents(useCase);

  let state: PipelineState = {
    jobId,
    useCase,
    iteration: 0,
    status: "idle",
    script: null,
    shot_list: null,
    audio_plan: null,
    audio_uris: [],
    video_uris: [],
    assembly_plan: null,
    score_report: null,
    final_score: null,
    improvement_notes: [],
    error: null,
  };

  const update = (status: PipelineStatus, patch: Partial<PipelineState> = {}) => {
    state = { ...state, status, ...patch };
    onUpdate(state);
  };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      state.iteration = iter + 1;

      // Scripting
      update("scripting");
      state.script = await agents.scriptWriter(inputText, state.improvement_notes);
      onUpdate(state);

      // Directing
      update("directing");
      state.shot_list = await agents.videoDirector(state.script);
      onUpdate(state);

      // Flatten shot list (director returns { shots: [...] })
      const shots: any[] = Array.isArray(state.shot_list)
        ? state.shot_list
        : (state.shot_list?.shots ?? []);

      // Audio plan — pass shot list so agent writes one narration per shot
      update("audio");
      state.audio_plan = await agents.audioAgent(state.script, state.shot_list);
      onUpdate(state);

      // TTS — convert per-shot narration to MP3s, ordered by shot index
      update("tts", { audio_uris: [] });
      const narrations: any[] = state.audio_plan?.narration ?? [];
      const sortedNarrations = [...narrations].sort(
        (a, b) => (a.shot_number ?? a.scene_number ?? 0) - (b.shot_number ?? b.scene_number ?? 0)
      );
      const audioUris = await generateNarrationAudio(sortedNarrations, jobId);
      update("tts", { audio_uris: audioUris.filter((u): u is string => u !== null) });

      // VIDEO_STYLE prepended to every prompt — controls animation style globally
      const videoStyle = process.env.VIDEO_STYLE?.trim();

      // Video generation — parallel batches of VIDEO_CONCURRENCY
      update("generating_videos", { video_uris: [] });
      const uris: string[] = [];
      for (let i = 0; i < shots.length; i += VIDEO_CONCURRENCY) {
        const batch = shots.slice(i, i + VIDEO_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((shot) => {
            const basePrompt = shot.video_prompt ?? shot.veo_prompt ?? shot.shot_description;
            const prompt = videoStyle ? `${videoStyle}. ${basePrompt}` : basePrompt;
            return generateVideoForShot(prompt, jobId);
          })
        );
        for (const result of results) {
          if (result.status === "fulfilled" && result.value !== null) {
            uris.push(result.value);
          }
        }
        update("generating_videos", { video_uris: [...uris] });
      }

      state.video_uris = uris;
      onUpdate(state);

      // Assembly — 1:1 pairing: clip[i] + audio[i]
      update("assembly");
      const shotSceneMap: number[] = shots.map((s) => s.scene_number ?? 1);
      const finalUri = await assembleVideo(state.video_uris, audioUris, jobId, shotSceneMap);
      update("assembly", { assembly_plan: { output_file: finalUri } });

      // Quality validation
      update("validating");
      const scoreReport = await agents.qualityValidator({
        sop: inputText,
        script: state.script,
        shot_list: state.shot_list,
        audio_plan: state.audio_plan,
        assembly_plan: state.assembly_plan,
      });
      update("validating", {
        score_report: scoreReport,
        final_score: scoreReport.overall_score ?? null,
        improvement_notes: scoreReport.improvement_notes ?? [],
      });
    }

    update("complete");
  } catch (err: any) {
    update("failed", { error: err?.message ?? String(err) });
  }

  return state;
}
