import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const key = process.env.XAI_API_KEY;
if (!key) throw new Error("Set XAI_API_KEY in your shell before generating media.");

const videos = [
  ["success-golden-launch", 6, "720p", "Cinematic documentary footage, a fictional research rocket lifting off at golden hour from a coastal launch pad, low tracking camera, white vapor rolling across the ground, realistic controlled ascent, no logos, no text, no people, silent."],
  ["success-stage-separation", 6, "720p", "Cinematic realistic view above Earth, a fictional two-stage research rocket performs a clean stage separation over the blue atmospheric limb, fairing panels drift gracefully away, sunlight glints on metal, no logos, no text, silent."],
  ["success-lunar-arrival", 6, "720p", "Cinematic orbital view, a compact fictional spacecraft coasts into lunar orbit while Earth rises beyond the Moon's cratered horizon, precise restrained motion, physically plausible sunlight, no logos, no text, silent."],
  ["failure-max-q", 6, "720p", "Cinematic but non-graphic mission simulation visualization: a fictional rocket loses structural integrity at maximum dynamic pressure and vanishes into dense clouds, no fireball, no people, no logos, no text, restrained scientific tone, silent."],
  ["failure-guidance", 6, "720p", "Cinematic mission simulation visualization: a fictional research rocket experiences guidance loss during ascent, slowly tumbles away from its intended trajectory into high clouds, no impact, no explosion, no people, no logos, no text, silent."],
  ["failure-payload", 6, "720p", "Cinematic orbital mission visualization: a fictional spacecraft fairing separates incorrectly in space and the payload mission is aborted, quiet debris-free controlled visual language, Earth far below, no logos, no text, silent."],
  ["landing-planet-pass", 8, "1080p", "Cinematic deep-space flythrough: a fictional rocket rushes past the camera toward a massive sunlit ocean planet, soft stars, subtle lens flare, elegant high contrast, slow enough for a website hero loop, no logos, no text, silent."],
  ["landing-aurora-orbit", 8, "1080p", "Cinematic orbital flythrough above Earth's night side, city lights and green aurora roll beneath the camera, minimal realistic stars, gentle motion designed for a website background loop, no logos, no text, silent."],
  ["landing-engine-stars", 8, "1080p", "Cinematic extreme close-up of a fictional rocket engine igniting, camera transitions smoothly through the blue-white plume into a quiet starfield, elegant restrained science-fiction, loop-friendly, no logos, no text, silent."],
];
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const output = join(process.cwd(), "public", "media");
await mkdir(output, { recursive: true });

for (const [id, duration, resolution, prompt] of videos) {
  console.log(`Generating ${id}…`);
  const created = await fetch("https://api.x.ai/v1/videos/generations", { method: "POST", headers, body: JSON.stringify({ model: "grok-imagine-video-1.5", prompt, duration, aspect_ratio: "16:9", resolution, generate_audio: false }) });
  if (!created.ok) throw new Error(`${id}: ${await created.text()}`);
  const { request_id } = await created.json();
  let result;
  do {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const status = await fetch(`https://api.x.ai/v1/videos/${request_id}`, { headers });
    result = await status.json();
  } while (result.status === "pending");
  if (result.status !== "done") throw new Error(`${id}: ${result.status}`);
  const file = await fetch(result.video.url);
  if (!file.ok) throw new Error(`${id}: download failed`);
  await writeFile(join(output, `${id}.mp4`), Buffer.from(await file.arrayBuffer()));
}
