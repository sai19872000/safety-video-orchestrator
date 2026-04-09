import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_MODEL = "veo3.1_fast"; // Gen-3 Alpha Turbo — best text-to-video on tier 1, good animation quality
const POLL_INTERVAL_MS = 60000; // 60s poll — gen3a_turbo is faster than gen4.5
// gen3a_turbo supports 5s or 10s clips
const CLIP_DURATION_SECONDS = 8;

function getApiKey(): string {
  if (!process.env.RUNWAY_API_KEY) {
    throw new Error("RUNWAY_API_KEY environment variable is not set");
  }
  return process.env.RUNWAY_API_KEY;
}

function runwayHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "X-Runway-Version": RUNWAY_VERSION,
    "Content-Type": "application/json",
  };
}

async function pollTask(taskId: string): Promise<string> {
  // Initial random jitter 0-10s so concurrent tasks don't all poll at the same time
  await new Promise((r) => setTimeout(r, Math.random() * 10000));

  while (true) {
    const res = await fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
      headers: runwayHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Runway poll failed (${res.status}): ${await res.text()}`);
    }

    const task = await res.json();
    console.log(`[runway] ${taskId.slice(0, 8)} → ${task.status}`);

    if (task.status === "SUCCEEDED") {
      const videoUrl = task.output?.[0];
      if (!videoUrl) throw new Error("Runway succeeded but returned no output URL");
      return videoUrl;
    }

    if (task.status === "FAILED") {
      throw new Error(`Runway task failed: ${task.error ?? "unknown error"}`);
    }

    // PENDING / RUNNING / THROTTLED — back off and retry
    const wait = task.status === "THROTTLED" ? POLL_INTERVAL_MS * 3 : POLL_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function generateVideoRunway(prompt: string, jobId: string): Promise<string | null> {
  const clipsDir = path.resolve(`./output/${jobId}/clips`);
  await mkdir(clipsDir, { recursive: true });

  // Submit text-to-video task
  const res = await fetch(`${RUNWAY_API_BASE}/text_to_video`, {
    method: "POST",
    headers: runwayHeaders(),
    body: JSON.stringify({
      model: RUNWAY_MODEL,
      promptText: prompt.slice(0, 1000), // API max 1000 chars
      ratio: "1280:720",
      duration: CLIP_DURATION_SECONDS,
    }),
  });

  if (!res.ok) {
    throw new Error(`Runway generation failed (${res.status}): ${await res.text()}`);
  }

  const task = await res.json();
  console.log(`[runway] task created: ${task.id} | status: ${task.status}`);

  // Poll until done, get signed video URL
  const videoUrl = await pollTask(task.id);

  // Download immediately — URL expires in 24-48h
  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error(`Failed to download Runway video: ${dlRes.status}`);

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  const filename = `${randomUUID()}.mp4`;
  const filepath = path.join(clipsDir, filename);
  await writeFile(filepath, buffer);
  console.log(`[runway] saved: ${filepath}`);

  return `/output/${jobId}/clips/${filename}`;
}
