import dotenv from "dotenv";
// Load .env.local first, fall back to .env
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import util from "util";
import { randomUUID } from "crypto";
import path from "path";
import { runPipeline } from "./src/services/orchestrator";
import { generateVideo } from "./src/services/sora";
import type { PipelineState } from "./src/services/types";

const execPromise = util.promisify(exec);

// In-memory job store: jobId → { latest state, connected SSE clients }
const jobs = new Map<
  string,
  { state: PipelineState | null; clients: Set<(s: PipelineState) => void> }
>();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT ?? "3001", 10);

  app.use(express.json());

  // --- Pipeline endpoints ---

  // POST /api/run-pipeline — start a new pipeline job, returns jobId immediately
  app.post("/api/run-pipeline", (req, res) => {
    const { sop } = req.body;
    if (!sop || typeof sop !== "string" || sop.trim().length === 0) {
      return res.status(400).json({ error: "sop text is required" });
    }

    const jobId = randomUUID();
    jobs.set(jobId, { state: null, clients: new Set() });

    // Fire pipeline async — updates broadcast to connected SSE clients
    runPipeline(jobId, sop.trim(), (state) => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.state = state;
      job.clients.forEach((cb) => cb(state));
    }).catch((err) => {
      console.error(`Pipeline job ${jobId} crashed:`, err);
    });

    res.json({ jobId });
  });

  // GET /api/pipeline-status/:jobId — SSE stream of pipeline state updates
  app.get("/api/pipeline-status/:jobId", (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (state: PipelineState) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      if (state.status === "complete" || state.status === "failed") {
        job.clients.delete(send);
        res.end();
      }
    };

    // Send current state to a late-connecting client
    if (job.state) {
      send(job.state);
    }

    // Subscribe to future updates if not already finished
    if (job.state?.status !== "complete" && job.state?.status !== "failed") {
      job.clients.add(send);
    }

    req.on("close", () => {
      job.clients.delete(send);
    });
  });

  // POST /api/generate-video — single video generation (direct use)
  app.post("/api/generate-video", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    try {
      const uri = await generateVideo(prompt, "standalone");
      res.json({ uri });
    } catch (error) {
      console.error("Video generation error:", error);
      res.status(500).json({ error: "Video generation failed" });
    }
  });

  // POST /api/assemble-video — execute FFmpeg commands from assembly plan
  app.post("/api/assemble-video", async (req, res) => {
    const { commands } = req.body;
    if (!Array.isArray(commands) || commands.some((c) => typeof c !== "string")) {
      return res.status(400).json({ error: "commands must be an array of strings" });
    }

    // Only allow ffmpeg commands to prevent command injection
    const invalid = commands.filter((c) => !/^ffmpeg\s/i.test(c.trim()));
    if (invalid.length > 0) {
      return res.status(400).json({ error: "Only ffmpeg commands are permitted" });
    }

    try {
      for (const command of commands) {
        await execPromise(command);
      }
      res.json({ status: "success", videoUrl: "/videos/final_video.mp4" });
    } catch (error) {
      console.error("Assembly error:", error);
      res.status(500).json({ error: "Video assembly failed" });
    }
  });

  // Serve all job output files: /output/{jobId}/clips/*.mp4, /output/{jobId}/audio/*.mp3, etc.
  app.use("/output", express.static(path.resolve("./output")));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("./dist")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
