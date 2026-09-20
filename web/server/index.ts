type Env = {
  /** Configure as a hosted runtime secret, never a client environment variable. */
  XAI_API_KEY?: string;
  /** Automatically provided by the hosting platform for the built static app. */
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const json = (message: string, status: number) => new Response(JSON.stringify({ message }), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function synthesizeSpeech(request: Request, env: Env) {
  if (!env.XAI_API_KEY) return json("Narration is not configured.", 503);
  let body: { text?: unknown; voiceId?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return json("Invalid narration request.", 400);
  }
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 5_000) {
    return json("A narration passage of up to 5,000 characters is required.", 400);
  }
  const upstream = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: body.text,
      voice_id: typeof body.voiceId === "string" ? body.voiceId : "eve",
      language: typeof body.language === "string" ? body.language : "en",
      response_format: "mp3",
    }),
  });
  if (!upstream.ok || !upstream.body) return json("Narration service unavailable.", upstream.status || 502);
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/tts") {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
      return synthesizeSpeech(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
