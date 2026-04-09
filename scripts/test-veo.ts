#!/usr/bin/env tsx
/**
 * Veo API validation test
 * Tests both generation submission and operation polling
 */
import { GoogleGenAI } from "@google/genai";

async function testVeo() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("❌ GOOGLE_API_KEY not set");
    process.exit(1);
  }

  console.log("🔑 API key:", apiKey.substring(0, 15) + "...");

  const ai = new GoogleGenAI({ apiKey });
  const model = "veo-3.0-generate-001";
  const prompt = "A red cube rotating slowly on a white surface, studio lighting, 4K";

  try {
    console.log("\n📤 Submitting Veo generation request...");
    const operation = await ai.models.generateVideos({
      model,
      prompt,
      config: { aspectRatio: "16:9", durationSeconds: 8 },
    });

    const operationName = (operation as any).name;
    console.log("✅ Operation started:", operationName);
    console.log("   Operation object keys:", Object.keys(operation));
    console.log("   done:", (operation as any).done);

    console.log("\n⏳ Polling operation status (via REST API with API key)...");
    let pollCount = 0;
    const maxPolls = 3;
    let done = false;

    while (!done && pollCount < maxPolls) {
      await new Promise((r) => setTimeout(r, 2000));
      pollCount++;

      console.log(`   Poll ${pollCount}/${maxPolls}...`);
      try {
        // Use REST API with API key instead of SDK operations.getVideosOperation
        const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
        const res = await fetch(pollUrl);

        if (!res.ok) {
          const errText = await res.text();
          console.error(`   ❌ Poll failed (${res.status}):`, errText);
          break;
        }

        const opStatus = await res.json();
        done = opStatus.done ?? false;
        console.log("   ✅ Poll succeeded, done:", done);

        if (done) {
          console.log("   Response keys:", Object.keys(opStatus.response || {}));
          console.log("   Has video:", !!opStatus.response?.generatedVideos?.[0]);
        }
      } catch (pollErr: any) {
        console.error("   ❌ Poll failed:", pollErr?.message ?? pollErr);
        break;
      }
    }

    if (pollCount >= maxPolls) {
      console.log("\n⏸️  Test complete (stopped after", maxPolls, "polls)");
      console.log("   To cancel this operation, run:");
      console.log(`   curl -X POST "https://generativelanguage.googleapis.com/v1beta/${operationName}:cancel?key=${apiKey}"`);
    }

  } catch (err: any) {
    console.error("\n❌ Test failed:", err?.message ?? err);
    console.error("Error details:", JSON.stringify(err, null, 2));
    process.exit(1);
  }
}

testVeo();
