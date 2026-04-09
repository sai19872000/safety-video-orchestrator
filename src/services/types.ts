export type VideoUseCase = "safety" | "educational" | "recreational";

export interface ReferenceImage {
  id: string;
  filename: string;
  path: string;
  url: string;
  label?: string;
  mimeType: string;
}

export interface ClarificationRequest {
  clarificationId: string;
  question: string;
  options?: string[];
  imageIds?: string[];
}

export interface ClarificationResponse {
  clarificationId: string;
  answer: string;
}

export type PipelineStatus =
  | "idle"
  | "scripting"
  | "directing"
  | "awaiting_clarification"
  | "audio"
  | "tts"
  | "generating_videos"
  | "assembly"
  | "validating"
  | "iterating"
  | "complete"
  | "failed";

export interface PipelineConfig {
  maxScenes: number;
}

export interface PipelineState {
  jobId: string;
  useCase: VideoUseCase;
  config: PipelineConfig;
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
  reference_images: ReferenceImage[];
  pending_clarification: ClarificationRequest | null;
  error: string | null;
}
