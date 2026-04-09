import { useState } from "react";
import type { PipelineState } from "./services/types";

const STATUS_LABEL: Record<string, string> = {
  scripting: "Writing script from SOP...",
  directing: "Planning shots & camera work...",
  audio: "Writing narration scripts...",
  tts: "Generating voiceover audio (TTS)...",
  generating_videos: "Generating video clips (Sora)...",
  assembly: "Building assembly timeline...",
  validating: "Validating against SOP...",
  iterating: "Score below threshold — refining...",
  complete: "Complete",
  failed: "Failed",
};

const PROGRESS: Record<string, number> = {
  scripting: 10,
  directing: 25,
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
  const [sopText, setSopText] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PipelineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!sopText.trim()) return;
    setLoading(true);
    setError(null);
    setState(null);

    try {
      // Start the pipeline job server-side
      const startRes = await fetch("/api/run-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sop: sopText }),
      });
      if (!startRes.ok) {
        const data = await startRes.json();
        throw new Error(data.error ?? "Failed to start pipeline");
      }
      const { jobId } = await startRes.json();

      // Stream live status updates via SSE
      await new Promise<void>((resolve, reject) => {
        const sse = new EventSource(`/api/pipeline-status/${jobId}`);
        sse.onmessage = (e) => {
          const update: PipelineState = JSON.parse(e.data);
          setState(update);
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
          <h1 className="text-4xl font-bold tracking-tight">Safety Video Orchestrator</h1>
          <p className="text-gray-400 mt-1">
            Paste a Safety SOP — the agent pipeline writes the script, plans shots,
            generates clips, assembles, and validates automatically.
          </p>
        </div>

        {/* SOP Input */}
        <textarea
          className="w-full h-48 p-4 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Paste your Safety SOP text here..."
          value={sopText}
          onChange={(e) => setSopText(e.target.value)}
          disabled={loading}
        />

        <button
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-semibold transition-colors"
          onClick={handleGenerate}
          disabled={loading || !sopText.trim()}
        >
          {loading ? "Generating..." : "Generate Safety Video"}
        </button>

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
            {/* Per-shot video generation progress */}
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
                <span className={`text-7xl font-black ${scoreColor}`}>{score ?? "—"}</span>
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
                    <div className="text-xl font-bold">{state.score_report.sop_coverage_score ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Production Quality</div>
                    <div className="text-xl font-bold">{state.score_report.production_quality_score ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Safety Accuracy</div>
                    <div className="text-xl font-bold">{state.score_report.safety_accuracy_score ?? "—"}</div>
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
                  download="safety_video.mp4"
                  className="inline-block mt-3 bg-green-700 hover:bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  Download Final Video
                </a>
              </div>
            )}

            {/* Individual clips (collapsible) */}
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
                No clips were generated. Check server logs for Sora errors.
              </p>
            )}

            {/* Pipeline details (collapsible) */}
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
