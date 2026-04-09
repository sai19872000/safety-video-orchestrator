import { useState, useRef } from "react";
import type { PipelineState, VideoUseCase, ReferenceImage, ClarificationRequest } from "./services/types";

const USE_CASE_OPTIONS: { value: VideoUseCase; label: string; description: string; placeholder: string }[] = [
  { value: "safety", label: "Safety Training", description: "Paste a Safety SOP — the agent pipeline writes the script, plans shots, generates clips, assembles, and validates automatically.", placeholder: "Paste your Safety SOP text here..." },
  { value: "educational", label: "Educational", description: "Paste lesson material or a topic — the pipeline creates an instructional video with clear explanations and visual aids.", placeholder: "Paste your lesson content, topic outline, or educational material here..." },
  { value: "recreational", label: "Recreational / Creative", description: "Describe a concept or story — the pipeline produces an entertaining, visually engaging video.", placeholder: "Describe your video concept, story idea, or creative brief here..." },
];

const STATUS_LABEL: Record<string, string> = {
  scripting: "Writing script from input...",
  directing: "Planning shots & camera work...",
  awaiting_clarification: "Waiting for your input...",
  audio: "Writing narration scripts...",
  tts: "Generating voiceover audio (TTS)...",
  generating_videos: "Generating video clips...",
  assembly: "Building assembly timeline...",
  validating: "Validating quality...",
  iterating: "Score below threshold — refining...",
  complete: "Complete",
  failed: "Failed",
};

const PROGRESS: Record<string, number> = {
  scripting: 10,
  directing: 25,
  awaiting_clarification: 28,
  audio: 30,
  tts: 42,
  generating_videos: 55,
  assembly: 75,
  validating: 88,
  iterating: 92,
  complete: 100,
  failed: 100,
};

export default function App() {
  const [useCase, setUseCase] = useState<VideoUseCase>("safety");
  const [sopText, setSopText] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PipelineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Image upload state
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clarification state
  const [clarification, setClarification] = useState<ClarificationRequest | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");

  const activeCaseOption = USE_CASE_OPTIONS.find((o) => o.value === useCase)!;

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      // Create job if needed
      let currentJobId = jobId;
      if (!currentJobId) {
        const res = await fetch("/api/create-job", { method: "POST" });
        const data = await res.json();
        currentJobId = data.jobId;
        setJobId(currentJobId);
      }

      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("images", file);
      }

      const res = await fetch(`/api/upload-images/${currentJobId}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setImages(data.images);
    } catch (err: any) {
      setError(err.message ?? "Image upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleClarificationSubmit = async () => {
    if (!clarification || !jobId || !clarificationAnswer.trim()) return;
    try {
      await fetch(`/api/clarification/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clarificationId: clarification.clarificationId,
          answer: clarificationAnswer.trim(),
        }),
      });
      setClarification(null);
      setClarificationAnswer("");
    } catch (err: any) {
      setError(err.message ?? "Failed to send clarification");
    }
  };

  const handleGenerate = async () => {
    if (!sopText.trim()) return;
    setLoading(true);
    setError(null);
    setState(null);
    setClarification(null);

    try {
      const startRes = await fetch("/api/run-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sop: sopText,
          useCase,
          jobId: jobId ?? undefined,
        }),
      });
      if (!startRes.ok) {
        const data = await startRes.json();
        throw new Error(data.error ?? "Failed to start pipeline");
      }
      const { jobId: activeJobId } = await startRes.json();
      if (!jobId) setJobId(activeJobId);

      await new Promise<void>((resolve, reject) => {
        const sse = new EventSource(`/api/pipeline-status/${activeJobId}`);
        sse.onmessage = (e) => {
          const update: PipelineState = JSON.parse(e.data);
          setState(update);

          if (
            update.status === "awaiting_clarification" &&
            update.pending_clarification
          ) {
            setClarification(update.pending_clarification);
          }

          if (update.status === "complete" || update.status === "failed") {
            sse.close();
            if (update.status === "failed") {
              reject(new Error(update.error ?? "Pipeline failed"));
            } else {
              resolve();
            }
          }
        };
        sse.onerror = () => {
          sse.close();
          reject(new Error("Lost connection to pipeline"));
        };
      });
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const score = state?.final_score ?? null;
  const scoreColor =
    score === null ? "text-gray-400" : score >= 75 ? "text-green-400" : "text-yellow-400";
  const videoUris = state?.video_uris ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Video Orchestrator</h1>
          <p className="text-gray-400 mt-1">{activeCaseOption.description}</p>
        </div>

        {/* Use Case Selector */}
        <div className="flex gap-2">
          {USE_CASE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                useCase === opt.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
              onClick={() => setUseCase(opt.value)}
              disabled={loading}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <textarea
          className="w-full h-48 p-4 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          placeholder={activeCaseOption.placeholder}
          value={sopText}
          onChange={(e) => setSopText(e.target.value)}
          disabled={loading}
        />

        {/* Reference Image Upload */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-300">Reference Images</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Optional — upload images to guide specific shots (max 10, 10MB each)
              </p>
            </div>
            <label className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              loading || uploading
                ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}>
              {uploading ? "Uploading..." : "Add Images"}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={loading || uploading}
                onChange={(e) => handleImageUpload(e.target.files)}
              />
            </label>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-5 gap-3">
              {images.map((img) => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.url}
                    alt={img.label ?? img.filename}
                    className="w-full aspect-square object-cover rounded-lg border border-gray-700"
                  />
                  <button
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(img.id)}
                    disabled={loading}
                  >
                    x
                  </button>
                  <p className="text-xs text-gray-500 truncate mt-1">{img.filename}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          onClick={handleGenerate}
          disabled={loading || !sopText.trim()}
        >
          {loading ? "Generating..." : "Generate Video"}
        </button>

        {/* Clarification Dialog */}
        {clarification && (
          <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-yellow-300">Clarification Needed</h3>
            <p className="text-sm text-yellow-200 whitespace-pre-wrap">{clarification.question}</p>

            {/* Show relevant images */}
            {clarification.imageIds && clarification.imageIds.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {clarification.imageIds.map((imgId) => {
                  const img = images.find((i) => i.id === imgId);
                  if (!img) return null;
                  return (
                    <div key={imgId} className="text-center">
                      <img
                        src={img.url}
                        alt={img.label ?? img.filename}
                        className="w-20 h-20 object-cover rounded-lg border border-yellow-700"
                      />
                      <p className="text-xs text-yellow-400 mt-1">{img.label ?? img.filename}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick option buttons */}
            {clarification.options && (
              <div className="flex gap-2 flex-wrap">
                {clarification.options.map((opt) => (
                  <button
                    key={opt}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      clarificationAnswer === opt
                        ? "bg-yellow-700 text-white"
                        : "bg-yellow-900 text-yellow-300 hover:bg-yellow-800"
                    }`}
                    onClick={() => setClarificationAnswer(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-gray-900 border border-yellow-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none"
                placeholder="Type your answer..."
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
              />
              <button
                className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                onClick={handleClarificationSubmit}
                disabled={!clarificationAnswer.trim()}
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {loading && state && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-300">{STATUS_LABEL[state.status] ?? state.status}</span>
              <span className="text-gray-500">
                Iteration {state.iteration} / 3
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${PROGRESS[state.status] ?? 0}%` }}
              />
            </div>
            {state.status === "generating_videos" && state.shot_list && (
              <p className="text-xs text-gray-400 mt-2">
                {state.video_uris.length} /{" "}
                {(Array.isArray(state.shot_list) ? state.shot_list : state.shot_list?.shots ?? []).length} clips generated
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-950 border border-red-700 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {state?.status === "complete" && (
          <div className="space-y-4">
            {/* Score card */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-gray-300 mb-4">Quality Score</h2>
              <div className="flex items-end gap-2 mb-4">
                <span className={`text-7xl font-black ${scoreColor}`}>{score ?? "\u2014"}</span>
                <span className="text-gray-500 text-2xl mb-2">/100</span>
                {score !== null && (
                  <span className={`mb-2 ml-2 text-sm font-semibold px-2 py-1 rounded ${score >= 75 ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
                    {score >= 75 ? "PASSED" : "BELOW THRESHOLD"}
                  </span>
                )}
              </div>

              {state.score_report && (
                <div className="grid grid-cols-3 gap-4 text-sm border-t border-gray-700 pt-4">
                  <div>
                    <div className="text-gray-500 mb-1">SOP Coverage</div>
                    <div className="text-xl font-bold">{state.score_report.sop_coverage_score ?? "\u2014"}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Production Quality</div>
                    <div className="text-xl font-bold">{state.score_report.production_quality_score ?? "\u2014"}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Safety Accuracy</div>
                    <div className="text-xl font-bold">{state.score_report.safety_accuracy_score ?? "\u2014"}</div>
                  </div>
                </div>
              )}

              {state.improvement_notes?.length > 0 && (
                <div className="mt-4 border-t border-gray-700 pt-4">
                  <div className="text-gray-500 text-sm mb-2">Notes</div>
                  <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                    {state.improvement_notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Audio output */}
            {(state.audio_uris?.length ?? 0) > 0 && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-300 mb-4">
                  Voiceover Audio ({state.audio_uris.length} scenes)
                </h2>
                <div className="space-y-3">
                  {state.audio_uris.map((uri, i) => (
                    <div key={uri} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-14 shrink-0">Scene {i + 1}</span>
                      <audio src={uri} controls className="flex-1 h-8" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Final assembled video */}
            {state.assembly_plan?.output_file && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-gray-300 mb-4">Final Video</h2>
                <video
                  src={state.assembly_plan.output_file}
                  controls
                  className="w-full rounded-lg bg-black"
                />
                <a
                  href={state.assembly_plan.output_file}
                  download="video.mp4"
                  className="inline-block mt-3 bg-green-700 hover:bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  Download Final Video
                </a>
              </div>
            )}

            {/* Individual clips */}
            {videoUris.length > 0 && (
              <details className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                <summary className="cursor-pointer text-sm text-gray-400 select-none">
                  Individual Clips ({videoUris.length})
                </summary>
                <div className="space-y-4 mt-4">
                  {videoUris.map((uri, i) => (
                    <div key={uri} className="space-y-2">
                      <p className="text-xs text-gray-500">Clip {i + 1}</p>
                      <video src={uri} controls className="w-full rounded-lg bg-black" />
                    </div>
                  ))}
                </div>
              </details>
            )}

            {!state.assembly_plan?.output_file && videoUris.length === 0 && (
              <p className="text-red-400 text-sm">
                No clips were generated. Check server logs for errors.
              </p>
            )}

            {/* Pipeline details */}
            <details className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <summary className="cursor-pointer text-sm text-gray-400 select-none">
                Pipeline Details (iteration {state.iteration})
              </summary>
              <pre className="mt-3 text-xs text-gray-400 overflow-auto max-h-96">
                {JSON.stringify(state, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
