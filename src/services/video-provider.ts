/**
 * Unified video generation entry point.
 * Set VIDEO_PROVIDER env var to switch providers:
 *   veo     — Google Veo 3.0, 8s clips (default)
 *   runway  — RunwayML Gen-4.5 text-to-video, 10s clips
 */
import { generateVideoVeo } from "./veo";
import { generateVideoRunway } from "./runway";

export async function generateVideo(
  prompt: string,
  jobId: string,
  imagePath: string | null = null
): Promise<string | null> {
  const provider = (process.env.VIDEO_PROVIDER ?? "veo").toLowerCase();

  if (provider === "runway") {
    console.log(`[video] provider=runway, hasImage=${!!imagePath}`);
    return generateVideoRunway(prompt, jobId, imagePath);
  }

  console.log(`[video] provider=veo, hasImage=${!!imagePath}`);
  return generateVideoVeo(prompt, jobId, imagePath);
}
