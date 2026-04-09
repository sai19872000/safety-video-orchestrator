import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const VEO_MODEL = "veo-3.1-generate-001";
const POLL_INTERVAL_MS = 10000;

function getClient(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable is not set");
  }
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

export async function generateVideoVeo(
  prompt: string,
  jobId: string,
  imagePath: string | null = null
): Promise<string | null> {
  const ai = getClient();
  const clipsDir = path.resolve(`./output/${jobId}/clips`);
  await mkdir(clipsDir, { recursive: true });

  const generateParams: any = {
    model: VEO_MODEL,
    prompt,
    config: {
      aspectRatio: "16:9",
      durationSeconds: 8,
    },
  };

  // Image-to-video: read file as base64 and attach
  if (imagePath) {
    const imageBytes = await readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    generateParams.image = {
      imageBytes: imageBytes.toString("base64"),
      mimeType,
    };
    console.log(`[veo] image-to-video with ${path.basename(imagePath)}`);
  }

  const operation = await ai.models.generateVideos(generateParams);

  const operationName = (operation as unknown as { name?: string }).name;
  if (!operationName) throw new Error("Veo operation returned no name");
  console.log(`[veo] operation started: ${operationName}`);

  let current: any = operation;
  while (!current.done) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    current = await ai.operations.getVideosOperation({
      operation: { name: operationName } as unknown as never,
    });
    console.log(`[veo] poll → done: ${current.done}`);
  }

  const videos = current.response?.generatedVideos ?? [];
  if (videos.length === 0) throw new Error("Veo returned no videos");

  const videoData = videos[0].video;
  if (!videoData) throw new Error("Veo video has no data");

  let buffer: Buffer;

  if (videoData.videoBytes) {
    buffer = Buffer.from(videoData.videoBytes, "base64");
  } else if (videoData.uri) {
    const res = await fetch(`${videoData.uri}&key=${process.env.GOOGLE_API_KEY}`);
    if (!res.ok) throw new Error(`Failed to download Veo video: ${res.status} ${await res.text()}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error("Veo video has neither uri nor videoBytes");
  }

  const filename = `${randomUUID()}.mp4`;
  const filepath = path.join(clipsDir, filename);
  await writeFile(filepath, buffer);
  console.log(`[veo] saved: ${filepath}`);

  return `/output/${jobId}/clips/${filename}`;
}
