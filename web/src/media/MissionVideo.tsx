import { useEffect, useState } from "react";
import type { MissionVideo } from "./videos";

export function MissionVideoPlayer({ video, className = "" }: { video: MissionVideo; className?: string }) {
  const [available, setAvailable] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  if (!available || reducedMotion) return null;
  return (
    <video
      className={className}
      aria-hidden="true"
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      onError={() => setAvailable(false)}
    >
      <source src={`/media/${video.filename}`} type="video/mp4" />
    </video>
  );
}
