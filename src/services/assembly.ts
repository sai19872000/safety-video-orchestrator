import { exec } from "child_process";
import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import util from "util";
import path from "path";

const execPromise = util.promisify(exec);

function uriToPath(uri: string): string {
  if (uri.startsWith("/output/")) return path.resolve(`.${uri}`);
  return path.resolve(uri);
}

async function hasNvenc(): Promise<boolean> {
  try {
    const { stdout } = await execPromise("ffmpeg -hide_banner -encoders 2>/dev/null");
    return stdout.includes("h264_nvenc");
  } catch {
    return false;
  }
}

/**
 * Shot-level assembly: pairs clip[i] with audio[i] (1:1), then concatenates.
 *
 * Each shot becomes: video clip (≤12s) + narration audio (≤10s) → merged with -shortest.
 * The final video is all shots concatenated in order.
 *
 * @param videoUris  ordered clip URIs — /output/{jobId}/clips/*.mp4
 * @param audioUris  ordered audio URIs — /output/{jobId}/audio/*.mp3, same index as videoUris (nulls ok)
 * @param jobId      job folder name
 */
export async function assembleVideo(
  videoUris: string[],
  audioUris: (string | null)[],
  jobId: string,
  _shotSceneMap?: number[] // kept for API compatibility, no longer used
): Promise<string> {
  if (videoUris.length === 0) throw new Error("No video clips to assemble");

  const jobDir = path.resolve(`./output/${jobId}`);
  const tmpDir = path.join(jobDir, "tmp");
  await mkdir(tmpDir, { recursive: true });

  const useGpu = await hasNvenc();
  console.log(`[assembly] GPU: ${useGpu ? "CUDA/h264_nvenc" : "software"} | ${videoUris.length} shots`);

  const videoCodec = useGpu
    ? "-c:v h264_nvenc -preset p4 -b:v 4M"
    : "-c:v libx264 -preset fast -crf 22";

  // ── Per-shot: merge clip + audio ─────────────────────────────────────────
  const shotOutputPaths: string[] = [];

  for (let i = 0; i < videoUris.length; i++) {
    const clipPath = uriToPath(videoUris[i]);
    if (!existsSync(clipPath)) {
      console.warn(`[assembly] shot ${i + 1}: clip not found, skipping — ${clipPath}`);
      continue;
    }

    const rawAudioUri = audioUris[i] ?? null;
    const audioPath = rawAudioUri ? uriToPath(rawAudioUri) : null;
    const hasAudio = audioPath && existsSync(audioPath);

    const shotOutputPath = path.join(tmpDir, `shot_${i}_final.mp4`);

    if (hasAudio) {
      console.log(`[assembly] shot ${i + 1}: merging clip (video only) + TTS audio`);
      // -map 0:v:0 = video from clip, -map 1:a:0 = audio from TTS (drops clip's original audio)
      // -shortest stops at end of TTS (≤10s), trimming the 12s clip
      await execPromise(
        `ffmpeg -y -i "${clipPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 ${videoCodec} -c:a aac -b:a 128k -shortest "${shotOutputPath}"`
      );
    } else {
      console.log(`[assembly] shot ${i + 1}: no audio, encoding video only`);
      await execPromise(
        `ffmpeg -y -i "${clipPath}" ${videoCodec} -an "${shotOutputPath}"`
      );
    }

    shotOutputPaths.push(shotOutputPath);
  }

  if (shotOutputPaths.length === 0) throw new Error("No shots were assembled");

  // ── Concatenate all shot finals → final_video.mp4 ────────────────────────
  const finalListPath = path.join(tmpDir, "final_list.txt");
  await writeFile(finalListPath, shotOutputPaths.map((p) => `file '${p}'`).join("\n"));

  const finalVideoPath = path.join(jobDir, "final_video.mp4");
  console.log("[assembly] Concatenating shots into final video...");
  await execPromise(
    `ffmpeg -y -f concat -safe 0 -i "${finalListPath}" -c copy "${finalVideoPath}"`
  );

  // Cleanup tmp
  await Promise.allSettled(
    [...shotOutputPaths, finalListPath].map((p) => unlink(p).catch(() => {}))
  );

  console.log(`[assembly] Done → ${finalVideoPath}`);
  return `/output/${jobId}/final_video.mp4`;
}
