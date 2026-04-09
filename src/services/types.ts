export type VideoUseCase = "safety" | "educational" | "recreational";

export type PipelineStatus =
  | "idle"
  | "scripting"
  | "directing"
  | "audio"
  | "tts"
  | "generating_videos"
  | "assembly"
  | "validating"
  | "iterating"
  | "complete"
  | "failed";

export interface PipelineState {
  jobId: string;
  useCase: VideoUseCase;
  iteration: number;
  status: PipelineStatus;
  script: any;
  shot_list: any;
  audio_plan: any;
  audio_uris: string[];
  video_uris: string[];
  assembly_plan: any;
  score_report: any;
  final_score: number | null;
  improvement_notes: string[];
  error: string | null;
}
