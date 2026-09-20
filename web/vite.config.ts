/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import glsl from "vite-plugin-glsl";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";
import presetData from "./src/data/rocket-presets.json";
import { validateRocketPresets } from "./src/data/rocketPresets";

// Run while Vite loads this configuration: unknown preset settings fail builds.
validateRocketPresets(presetData);

function xaiTtsDevProxy(xaiApiKey: string | undefined) {
  return {
    name: "xai-tts-dev-proxy",
    configureServer(server: { middlewares: { use: (path: string, handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void) => void } }) {
      server.middlewares.use("/api/tts", (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }
        let raw = "";
        request.on("data", (chunk) => { raw += chunk; });
        request.on("end", () => void (async () => {
          if (!xaiApiKey) {
            response.writeHead(503, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "Narration is not configured." }));
            return;
          }
          try {
            const body = JSON.parse(raw) as { text?: unknown; voiceId?: unknown; language?: unknown };
            if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 5_000) throw new Error("invalid");
            const upstream = await fetch("https://api.x.ai/v1/tts", {
              method: "POST",
              headers: { Authorization: `Bearer ${xaiApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ text: body.text, voice_id: typeof body.voiceId === "string" ? body.voiceId : "eve", language: typeof body.language === "string" ? body.language : "en", response_format: "mp3" }),
            });
            response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg" });
            response.end(Buffer.from(await upstream.arrayBuffer()));
          } catch {
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ message: "Invalid narration request." }));
          }
        })());
      });
}

export default defineConfig(({ mode }) => {
  // Vite does not put values from .env.local into process.env while this file loads.
  // Load the server secret explicitly and do not expose it through a VITE_ variable.
  const { XAI_API_KEY: xaiApiKey } = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [sites(), xaiTtsDevProxy(xaiApiKey), react(), tailwindcss(), glsl({ root: "/node_modules", removeDuplicatedImports: true, warnDuplicatedImports: false })],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    worker: {
      format: "es",
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      testTimeout: 30_000,
      coverage: {
        provider: "v8",
        include: ["src/domain/**", "src/sim/**", "src/workers/**"],
      },
    },
  };
});
