export type MissionVideo = {
  id: string;
  role: "success" | "failure" | "landing";
  prompt: string;
  filename: string;
  duration: number;
  resolution: "720p" | "1080p";
};

/** The approved media brief. Generation is performed offline and assets are reviewed before release. */
export const missionVideos: MissionVideo[] = [
  { id: "success-golden-launch", role: "success", filename: "success-golden-launch.mp4", duration: 6, resolution: "720p", prompt: "Cinematic documentary footage, a fictional research rocket lifting off at golden hour from a coastal launch pad, low tracking camera, white vapor rolling across the ground, realistic controlled ascent, no logos, no text, no people, silent." },
  { id: "success-stage-separation", role: "success", filename: "success-stage-separation.mp4", duration: 6, resolution: "720p", prompt: "Cinematic realistic view above Earth, a fictional two-stage research rocket performs a clean stage separation over the blue atmospheric limb, fairing panels drift gracefully away, sunlight glints on metal, no logos, no text, silent." },
  { id: "success-lunar-arrival", role: "success", filename: "successful_mission.mp4", duration: 6, resolution: "720p", prompt: "Successful mission outcome video supplied with the application." },
  { id: "failure-max-q", role: "failure", filename: "failure-max-q.mp4", duration: 6, resolution: "720p", prompt: "Cinematic but non-graphic mission simulation visualization: a fictional rocket loses structural integrity at maximum dynamic pressure and vanishes into dense clouds, no fireball, no people, no logos, no text, restrained scientific tone, silent." },
  { id: "failure-guidance", role: "failure", filename: "failed_mission.mp4", duration: 6, resolution: "720p", prompt: "Failed mission outcome video supplied with the application." },
  { id: "failure-payload", role: "failure", filename: "failure-payload.mp4", duration: 6, resolution: "720p", prompt: "Cinematic orbital mission visualization: a fictional spacecraft fairing separates incorrectly in space and the payload mission is aborted, quiet debris-free controlled visual language, Earth far below, no logos, no text, silent." },
  { id: "landing-planet-pass", role: "landing", filename: "landing-planet-pass.mp4", duration: 8, resolution: "1080p", prompt: "Cinematic deep-space flythrough: a fictional rocket rushes past the camera toward a massive sunlit ocean planet, soft stars, subtle lens flare, elegant high contrast, slow enough for a website hero loop, no logos, no text, silent." },
  { id: "landing-aurora-orbit", role: "landing", filename: "landing-aurora-orbit.mp4", duration: 8, resolution: "1080p", prompt: "Cinematic orbital flythrough above Earth's night side, city lights and green aurora roll beneath the camera, minimal realistic stars, gentle motion designed for a website background loop, no logos, no text, silent." },
  { id: "landing-engine-stars", role: "landing", filename: "landing-engine-stars.mp4", duration: 8, resolution: "1080p", prompt: "Cinematic extreme close-up of a fictional rocket engine igniting, camera transitions smoothly through the blue-white plume into a quiet starfield, elegant restrained science-fiction, loop-friendly, no logos, no text, silent." },
];

export const landingVideo = missionVideos.find((video) => video.id === "landing-planet-pass")!;
export const outcomeVideo = (successful: boolean) => missionVideos.find((video) => video.id === (successful ? "success-lunar-arrival" : "failure-guidance"))!;
