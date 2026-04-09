import { createAgents } from "./agents";
import { generateVideo } from "./video-provider";
import { generateNarrationAudio } from "./tts";
import { assembleVideo } from "./assembly";
import type {
  PipelineState,
  PipelineStatus,
  PipelineConfig,
  VideoUseCase,
  ReferenceImage,
  ClarificationRequest,
  ClarificationResponse,
} from "./types";

export type { PipelineState, PipelineStatus };

const MAX_ITERATIONS = 1; // TODO: restore to 2+ for production
const DEFAULT_MAX_SCENES = 5;
const VIDEO_CONCURRENCY = 5;
const CLARIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function generateVideoForShot(
  prompt: string,
  jobId: string,
  imagePath: string | null = null
): Promise<string | null> {
  try {
    return await generateVideo(prompt, jobId, imagePath);
  } catch (err: any) {
    console.error("Video generation failed for shot:", err?.message ?? err);
    return null;
  }
}

export async function runPipeline(
  jobId: string,
  inputText: string,
  useCase: VideoUseCase,
  onUpdate: (state: PipelineState) => void,
  referenceImages: ReferenceImage[] = [],
  requestClarification?: (req: ClarificationRequest) => Promise<ClarificationResponse>,
  config: PipelineConfig = { maxScenes: DEFAULT_MAX_SCENES }
): Promise<PipelineState> {
  const agents = createAgents(useCase);
  const maxScenes = config.maxScenes;

  let state: PipelineState = {
    jobId,
    useCase,
    config,
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
    reference_images: referenceImages,
    pending_clarification: null,
    error: null,
  };

  const update = (status: PipelineStatus, patch: Partial<PipelineState> = {}) => {
    state = { ...state, status, ...patch };
    onUpdate(state);
  };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      state.iteration = iter + 1;

      // Scripting — cap scenes so all downstream agents stay in sync
      update("scripting");
      const rawScript = await agents.scriptWriter(inputText, state.improvement_notes);
      if (rawScript.scenes && rawScript.scenes.length > maxScenes) {
        rawScript.scenes = rawScript.scenes.slice(0, maxScenes);
      }
      state.script = rawScript;
      onUpdate(state);

      // Directing — pass reference images so director can assign them to shots
      update("directing");
      state.shot_list = await agents.videoDirector(state.script, referenceImages);
      onUpdate(state);

      // Flatten shot list
      const shots: any[] = Array.isArray(state.shot_list)
        ? state.shot_list
        : (state.shot_list?.shots ?? []);

      // Handle clarification requests from the director
      if (referenceImages.length > 0 && requestClarification) {
        const ambiguousShots = shots.filter((s) => s.reference_image_id === "ask_user");
        if (ambiguousShots.length > 0) {
          const shotDescriptions = ambiguousShots
            .map((s) => `Shot ${s.scene_number}: ${s.shot_description}`)
            .join("\n");
          const imageOptions = referenceImages.map((img) => img.label ?? img.filename);

          const clarificationReq: ClarificationRequest = {
            clarificationId: `${jobId}-clarify-${iter}`,
            question: `The director is unsure which reference image to use for these shots:\n${shotDescriptions}\n\nPlease specify which image to use for each, or type "skip" to use text-to-video instead.`,
            options: [...imageOptions, "skip"],
            imageIds: referenceImages.map((img) => img.id),
          };

          update("awaiting_clarification", { pending_clarification: clarificationReq });

          // Await user response with timeout
          const response = await Promise.race([
            requestClarification(clarificationReq),
            new Promise<ClarificationResponse>((_, reject) =>
              setTimeout(() => reject(new Error("Clarification timed out after 5 minutes")), CLARIFICATION_TIMEOUT_MS)
            ),
          ]);

          update("directing", { pending_clarification: null });

          // Apply the user's answer: match to an image or skip
          const answer = response.answer.trim().toLowerCase();
          if (answer !== "skip") {
            const matchedImage = referenceImages.find(
              (img) =>
                (img.label ?? img.filename).toLowerCase() === answer ||
                img.id === answer
            );
            if (matchedImage) {
              for (const shot of ambiguousShots) {
                shot.reference_image_id = matchedImage.id;
              }
            }
          }
          // Clear ask_user markers for any unresolved shots
          for (const shot of ambiguousShots) {
            if (shot.reference_image_id === "ask_user") {
              delete shot.reference_image_id;
            }
          }
        }
      }

      // Audio plan
      update("audio");
      state.audio_plan = await agents.audioAgent(state.script, state.shot_list);
      onUpdate(state);

      // TTS
      update("tts", { audio_uris: [] });
      const narrations: any[] = state.audio_plan?.narration ?? [];
      const sortedNarrations = [...narrations].sort(
        (a, b) => (a.shot_number ?? a.scene_number ?? 0) - (b.shot_number ?? b.scene_number ?? 0)
      );
      const audioUris = await generateNarrationAudio(sortedNarrations, jobId);
      update("tts", { audio_uris: audioUris.filter((u): u is string => u !== null) });

      const videoStyle = process.env.VIDEO_STYLE?.trim();

      // Video generation — resolve reference images per shot
      update("generating_videos", { video_uris: [] });
      const uris: string[] = [];
      for (let i = 0; i < shots.length; i += VIDEO_CONCURRENCY) {
        const batch = shots.slice(i, i + VIDEO_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((shot) => {
            const basePrompt = shot.video_prompt ?? shot.veo_prompt ?? shot.shot_description;
            const prompt = videoStyle ? `${videoStyle}. ${basePrompt}` : basePrompt;

            // Look up reference image for this shot
            let imagePath: string | null = null;
            if (shot.reference_image_id && shot.reference_image_id !== "ask_user") {
              const refImg = referenceImages.find((img) => img.id === shot.reference_image_id);
              if (refImg) imagePath = refImg.path;
            }

            return generateVideoForShot(prompt, jobId, imagePath);
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

      // Assembly
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
