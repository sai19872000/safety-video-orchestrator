/**
 * One-off script: assemble the existing output files into final_video.mp4
 * Usage: ./node_modules/.bin/tsx scripts/assemble-existing.ts
 */
import { readdirSync, statSync } from "fs";
import path from "path";
import { assembleVideo } from "../src/services/assembly";

const OUTPUT_DIR = path.resolve("./output");
const AUDIO_DIR = path.resolve("./output/audio");

// Get all clip .mp4s (exclude intermediate files we generate), sorted by mtime
const videoFiles = readdirSync(OUTPUT_DIR)
  .filter((f) => f.endsWith(".mp4") && !["videos_concat.mp4", "final_video.mp4"].includes(f))
  .map((f) => ({ name: f, mtime: statSync(path.join(OUTPUT_DIR, f)).mtimeMs }))
  .sort((a, b) => a.mtime - b.mtime) // oldest first = original shot order
  .map((f) => `/videos/${f.name}`);

// Get audio files, deduplicate by scene number (keep latest), sorted by scene number
const audioByScene = new Map<number, { name: string; mtime: number }>();
readdirSync(AUDIO_DIR)
  .filter((f) => f.endsWith(".mp3"))
  .forEach((f) => {
    const match = f.match(/^scene_(\d+)_/);
    if (!match) return;
    const sceneNum = parseInt(match[1], 10);
    const mtime = statSync(path.join(AUDIO_DIR, f)).mtimeMs;
    const existing = audioByScene.get(sceneNum);
    if (!existing || mtime > existing.mtime) {
      audioByScene.set(sceneNum, { name: f, mtime });
    }
  });

const audioFiles = [...audioByScene.entries()]
  .sort(([a], [b]) => a - b) // sort by scene number
  .map(([, { name }]) => `/audio/${name}`);

console.log(`[assemble] ${videoFiles.length} clips, ${audioFiles.length} audio scenes`);
videoFiles.forEach((v, i) => console.log(`  video ${i + 1}: ${v}`));
audioFiles.forEach((a, i) => console.log(`  audio ${i + 1}: ${a}`));

const result = await assembleVideo(videoFiles, audioFiles, "existing");
console.log(`\n✓ Final video: ${result}`);
console.log(`  File: ${path.join(OUTPUT_DIR, "final_video.mp4")}`);
