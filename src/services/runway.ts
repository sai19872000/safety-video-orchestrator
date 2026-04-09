import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_MODEL = "gen4.5";
const POLL_INTERVAL_MS = 60000;
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

    const wait = task.status === "THROTTLED" ? POLL_INTERVAL_MS * 3 : POLL_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function generateVideoRunway(
  prompt: string,
  jobId: string,
  imagePath: string | null = null
): Promise<string | null> {
  const clipsDir = path.resolve(`./output/${jobId}/clips`);
  await mkdir(clipsDir, { recursive: true });

  let endpoint: string;
  let body: Record<string, any>;

  if (imagePath) {
    // Image-to-video: encode as data URI
    const imageBytes = await readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${imageBytes.toString("base64")}`;

    endpoint = `${RUNWAY_API_BASE}/image_to_video`;
    body = {
      model: RUNWAY_MODEL,
      promptImage: dataUri,
      promptText: prompt.slice(0, 1000),
      ratio: "1280:720",
      duration: CLIP_DURATION_SECONDS,
    };
    console.log(`[runway] image-to-video with ${path.basename(imagePath)}`);
  } else {
    endpoint = `${RUNWAY_API_BASE}/text_to_video`;
    body = {
      model: RUNWAY_MODEL,
      promptText: prompt.slice(0, 1000),
      ratio: "1280:720",
      duration: CLIP_DURATION_SECONDS,
    };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: runwayHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Runway generation failed (${res.status}): ${await res.text()}`);
  }

  const task = await res.json();
  console.log(`[runway] task created: ${task.id} | status: ${task.status}`);

  const videoUrl = await pollTask(task.id);

  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error(`Failed to download Runway video: ${dlRes.status}`);

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  const filename = `${randomUUID()}.mp4`;
  const filepath = path.join(clipsDir, filename);
  await writeFile(filepath, buffer);
  console.log(`[runway] saved: ${filepath}`);

  return `/output/${jobId}/clips/${filename}`;
}
