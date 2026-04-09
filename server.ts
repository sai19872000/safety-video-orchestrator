import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import express from "express";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import util from "util";
import { randomUUID } from "crypto";
import path from "path";
import { mkdir } from "fs/promises";
import { runPipeline } from "./src/services/orchestrator";
import { generateVideo } from "./src/services/video-provider";
import type {
  PipelineState,
  VideoUseCase,
  ReferenceImage,
  ClarificationRequest,
  ClarificationResponse,
} from "./src/services/types";

const execPromise = util.promisify(exec);

const VALID_USE_CASES: VideoUseCase[] = ["safety", "educational", "recreational"];
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

// In-memory job store
const jobs = new Map<
  string,
  {
    state: PipelineState | null;
    clients: Set<(s: PipelineState) => void>;
    images: ReferenceImage[];
  }
>();

// Pending clarification resolvers
const pendingClarifications = new Map<
  string,
  { resolve: (resp: ClarificationResponse) => void }
>();

// Multer disk storage — files go to ./uploads/{jobId}/
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const jobId = req.params.jobId;
    const dir = path.resolve(`./uploads/${jobId}`);
    await mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const id = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME_TYPES.includes(file.mimetype));
  },
});

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT ?? "3001", 10);

  app.use(express.json());

  // Serve uploaded images
  app.use("/uploads", express.static(path.resolve("./uploads")));

  // --- Job management ---

  // POST /api/create-job — create a job ID for image uploads before pipeline start
  app.post("/api/create-job", (_req, res) => {
    const jobId = randomUUID();
    jobs.set(jobId, { state: null, clients: new Set(), images: [] });
    res.json({ jobId });
  });

  // POST /api/upload-images/:jobId — upload up to 10 reference images
  app.post("/api/upload-images/:jobId", upload.array("images", 10), (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found. Call /api/create-job first." });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No valid images uploaded" });
    }

    const images: ReferenceImage[] = files.map((f) => {
      const id = path.basename(f.filename, path.extname(f.filename));
      return {
        id,
        filename: f.originalname,
        path: f.path,
        url: `/uploads/${jobId}/${f.filename}`,
        mimeType: f.mimetype,
      };
    });

    job.images.push(...images);
    res.json({ images: job.images });
  });

  // --- Pipeline endpoints ---

  // POST /api/run-pipeline — start pipeline, optionally reuse existing jobId with uploaded images
  app.post("/api/run-pipeline", (req, res) => {
    const { sop, useCase = "safety", jobId: existingJobId } = req.body;
    if (!sop || typeof sop !== "string" || sop.trim().length === 0) {
      return res.status(400).json({ error: "sop text is required" });
    }
    if (!VALID_USE_CASES.includes(useCase)) {
      return res
        .status(400)
        .json({ error: `useCase must be one of: ${VALID_USE_CASES.join(", ")}` });
    }

    // Reuse existing job (with uploaded images) or create a new one
    let jobId: string;
    let referenceImages: ReferenceImage[];
    if (existingJobId && jobs.has(existingJobId)) {
      jobId = existingJobId;
      referenceImages = jobs.get(existingJobId)!.images;
    } else {
      jobId = randomUUID();
      jobs.set(jobId, { state: null, clients: new Set(), images: [] });
      referenceImages = [];
    }

    // Clarification callback — pauses pipeline until user responds
    const requestClarification = (
      req: ClarificationRequest
    ): Promise<ClarificationResponse> => {
      return new Promise((resolve) => {
        pendingClarifications.set(req.clarificationId, { resolve });
      });
    };

    runPipeline(
      jobId,
      sop.trim(),
      useCase,
      (state) => {
        const job = jobs.get(jobId);
        if (!job) return;
        job.state = state;
        job.clients.forEach((cb) => cb(state));
      },
      referenceImages,
      requestClarification
    ).catch((err) => {
      console.error(`Pipeline job ${jobId} crashed:`, err);
    });

    res.json({ jobId });
  });

  // POST /api/clarification/:jobId — user answers a clarification question
  app.post("/api/clarification/:jobId", (req, res) => {
    const { clarificationId, answer } = req.body;
    if (!clarificationId || typeof answer !== "string") {
      return res
        .status(400)
        .json({ error: "clarificationId and answer are required" });
    }

    const pending = pendingClarifications.get(clarificationId);
    if (!pending) {
      return res.status(404).json({ error: "No pending clarification with that ID" });
    }

    pending.resolve({ clarificationId, answer });
    pendingClarifications.delete(clarificationId);
    res.json({ status: "ok" });
  });

  // GET /api/pipeline-status/:jobId — SSE stream
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

    if (job.state) {
      send(job.state);
    }

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

  // POST /api/assemble-video — execute FFmpeg commands
  app.post("/api/assemble-video", async (req, res) => {
    const { commands } = req.body;
    if (!Array.isArray(commands) || commands.some((c) => typeof c !== "string")) {
      return res.status(400).json({ error: "commands must be an array of strings" });
    }

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

  // Serve job output files
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
