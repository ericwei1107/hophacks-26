import { useEffect, useRef, useState } from "react";

type NarrationButtonProps = {
  text: string;
  label?: string;
};

type State = "idle" | "loading" | "playing" | "error" | "unavailable";

const audioCache = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;

/**
 * Narration is configured once per page, not once per button. When the server
 * reports that no API key is set, every button switches to "unavailable"
 * instead of each one re-asking and failing on its own.
 */
let narrationDisabledReason: string | null = null;

function stopActiveNarration() {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
}

async function messageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Not JSON; fall through to a generic message.
  }
  return `Narration request failed (${response.status}).`;
}

/** Plays cached Grok TTS audio returned by our same-origin API route. */
export function NarrationButton({ text, label = "Listen" }: NarrationButtonProps) {
  const [state, setState] = useState<State>(narrationDisabledReason ? "unavailable" : "idle");
  const [reason, setReason] = useState<string | null>(narrationDisabledReason);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    if (activeAudio === audioRef.current) stopActiveNarration();
  }, []);

  const toggle = async () => {
    if (state === "unavailable") {
      return;
    }
    if (state === "playing") {
      stopActiveNarration();
      setState("idle");
      return;
    }

    setState("loading");
    try {
      stopActiveNarration();
      let src = audioCache.get(text);
      if (!src) {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceId: "eve", language: "en" }),
        });
        if (!response.ok) {
          const message = await messageFrom(response);
          // 503 is the server saying it has no key: retrying cannot help.
          if (response.status === 503) {
            narrationDisabledReason = message;
            setReason(message);
            setState("unavailable");
            return;
          }
          setReason(message);
          setState("error");
          return;
        }
        src = URL.createObjectURL(await response.blob());
        audioCache.set(text, src);
      }
      const audio = new Audio(src);
      audioRef.current = audio;
      activeAudio = audio;
      audio.addEventListener("ended", () => {
        if (activeAudio === audio) activeAudio = null;
        setState("idle");
      });
      audio.addEventListener("error", () => {
        setReason("The narration audio could not be played.");
        setState("error");
      });
      await audio.play();
      setState("playing");
    } catch (error) {
      setReason(error instanceof Error ? error.message : "Narration is unavailable.");
      setState("error");
    }
  };

  const textLabel =
    state === "loading"
      ? "Loading narration"
      : state === "playing"
        ? "Stop narration"
        : state === "unavailable"
          ? "Audio off"
          : state === "error"
            ? "Retry audio"
            : label;
  const title =
    state === "unavailable"
      ? `${reason ?? "Narration is not configured."} Set XAI_API_KEY in web/.env and restart the dev server.`
      : state === "error"
        ? `${reason ?? "Narration is unavailable."} Click to try again.`
        : textLabel;

  return (
    <button
      type="button"
      className={`narration-button${state === "unavailable" ? " unavailable" : ""}`}
      onClick={() => void toggle()}
      aria-label={textLabel}
      aria-pressed={state === "playing"}
      disabled={state === "loading" || state === "unavailable"}
      title={title}
    >
      <span aria-hidden="true">
        {state === "playing" ? "■" : state === "loading" ? "…" : state === "unavailable" ? "🔇" : "▶"}
      </span>
      <span>{textLabel}</span>
    </button>
  );
}
