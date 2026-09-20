import { useEffect, useRef, useState } from "react";

type NarrationButtonProps = {
  text: string;
  label?: string;
};

const audioCache = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;

function stopActiveNarration() {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
}

/** Plays cached Grok TTS audio returned by our same-origin API route. */
export function NarrationButton({ text, label = "Listen" }: NarrationButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    if (activeAudio === audioRef.current) stopActiveNarration();
  }, []);

  const toggle = async () => {
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
        if (!response.ok) throw new Error("Narration request failed");
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
      audio.addEventListener("error", () => setState("error"));
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };

  const textLabel = state === "loading" ? "Loading narration" : state === "playing" ? "Stop narration" : label;
  return (
    <button
      type="button"
      className="narration-button"
      onClick={() => void toggle()}
      aria-label={textLabel}
      aria-pressed={state === "playing"}
      disabled={state === "loading"}
      title={state === "error" ? "Narration is unavailable. Try again." : textLabel}
    >
      <span aria-hidden="true">{state === "playing" ? "■" : state === "loading" ? "…" : "▶"}</span>
      <span>{state === "error" ? "Retry audio" : textLabel}</span>
    </button>
  );
}
