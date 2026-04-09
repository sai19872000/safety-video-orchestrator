/**
 * Unified video generation entry point.
 * Set VIDEO_PROVIDER env var to switch providers:
 *   sora    — OpenAI Sora 2 Pro (default), 12s clips
 *   veo     — Google Veo 3.0, 8s clips
 *   runway  — RunwayML Gen-4.5 text-to-video, 10s clips
 */
import { generateVideo as generateVideoSora } from "./sora";
import { generateVideoVeo } from "./veo";
import { generateVideoRunway } from "./runway";

export async function generateVideo(prompt: string, jobId: string): Promise<string | null> {
  const provider = (process.env.VIDEO_PROVIDER ?? "sora").toLowerCase();

  if (provider === "veo") {
    console.log(`[video] provider=veo`);
    return generateVideoVeo(prompt, jobId);
  }

  if (provider === "runway") {
    console.log(`[video] provider=runway`);
    return generateVideoRunway(prompt, jobId);
  }

  console.log(`[video] provider=sora`);
  return generateVideoSora(prompt, jobId);
}
