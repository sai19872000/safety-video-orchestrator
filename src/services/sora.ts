import OpenAI from "openai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const SORA_MODEL = "sora-2-pro";
const POLL_INTERVAL_MS = 40000;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function generateVideo(prompt: string, jobId: string): Promise<string | null> {
  const client = getClient();
  const clipsDir = path.resolve(`./output/${jobId}/clips`);
  await mkdir(clipsDir, { recursive: true });

  const job = await client.videos.create({
    model: SORA_MODEL,
    prompt,
    size: "1280x720",
    seconds: "12",
  });
  console.log(`[sora] job created: ${job.id} | status: ${job.status}`);

  let current = job;
  while (current.status === "in_progress" || (current.status as string) === "queued") {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    current = await client.videos.retrieve(job.id);
    console.log(`[sora] poll → status: ${current.status} | progress: ${current.progress}`);
  }

  if (current.status !== "completed") {
    throw new Error(`Sora job ${job.id} ended with status: ${current.status}`);
  }

  const content = await client.videos.downloadContent(job.id);
  const buffer = Buffer.from(await content.arrayBuffer());
  const filename = `${randomUUID()}.mp4`;
  const filepath = path.join(clipsDir, filename);
  await writeFile(filepath, buffer);
  console.log(`[sora] saved: ${filepath}`);

  return `/output/${jobId}/clips/${filename}`;
}
