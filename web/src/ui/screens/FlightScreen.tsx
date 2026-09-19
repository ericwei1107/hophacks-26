/**
 * Flight screen: 3D scene, HUD readouts, event timeline, playback controls.
 * No piloting controls — the autopilot flies the recorded trajectory.
 */

import { useEffect, useRef, useState } from "react";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useFrame, useThree } from "@react-three/fiber";

import { SafeCanvas } from "../components/SafeCanvas";
import { playbackClock, resetPlaybackClock } from "../playbackClock";
import { useAppStore, type CameraMode } from "../store";
import { PHASE_NAMES, sampleTelemetry, type FlightSample } from "../telemetry";
import { FlightScene } from "../components/FlightScene";

/** Lowers pixel ratio (and reports sustained low fps) when the frame rate drops. */
function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const lowEffects = useAppStore((s) => s.settings.lowEffects);
  const acc = useRef({ frames: 0, time: 0, level: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames++;
    a.time += delta;
    if (a.time >= 2) {
      const fps = a.frames / a.time;
      a.frames = 0;
      a.time = 0;
      if (fps < 30 && a.level < 2) {
        a.level++;
        setDpr(Math.max(0.75, 1.5 - a.level * 0.25));
      } else if (fps > 55 && a.level > 0) {
        a.level--;
        setDpr(Math.max(0.75, 1.5 - a.level * 0.25));
      }
    }
  });
  // Bloom cost scales with resolution; nothing to do here when lowEffects
  // (the composer is already absent).
  void lowEffects;
  return null;
}

const SPEEDS = [1, 5, 20];
const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "overhead", label: "Overhead" },
  { id: "chase", label: "Chase" },
  { id: "ground", label: "Ground" },
  { id: "orbit", label: "Orbit" },
];

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `T+${m}:${sec.toString().padStart(2, "0")}`;
}

function HudReadout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="hud-item">
      <span className="hud-label">{label}</span>
      <span className="hud-value">
        {value}
        {unit && <span className="hud-unit"> {unit}</span>}
      </span>
    </div>
  );
}

export function FlightScreen() {
  const { flight, playing, playbackSpeed, cameraMode, settings, setPlaying, setPlaybackSpeed, setCameraMode, setScreen } =
    useAppStore();
  const [sample, setSample] = useState<FlightSample | null>(null);
  const [hidden, setHidden] = useState(document.hidden);

  // Suspend rendering while the tab is hidden.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Reset the clock when a new flight loads.
  useEffect(() => {
    if (flight) {
      resetPlaybackClock(flight.totalTimeS);
    }
  }, [flight]);

  // Advance the clock and refresh HUD readouts at display rate.
  useEffect(() => {
    if (!flight) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (useAppStore.getState().playing) {
        playbackClock.timeS = Math.min(
          playbackClock.durationS,
          playbackClock.timeS + dt * useAppStore.getState().playbackSpeed,
        );
      }
      setSample(sampleTelemetry(flight.telemetry, playbackClock.timeS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  if (!flight) {
    return (
      <div className="screen flight">
        <p>No flight loaded.</p>
        <button onClick={() => setScreen("assembly")}>Back to build</button>
      </div>
    );
  }

  const duration = playbackClock.durationS;
  const progress = duration > 0 ? playbackClock.timeS / duration : 0;

  return (
    <div className="screen flight">
      <div className="viewport">
        <SafeCanvas
          camera={{ fov: 50, near: 0.0001, far: 100_000 }}
          gl={{ logarithmicDepthBuffer: true }}
          frameloop={hidden ? "never" : "always"}
          dpr={settings.lowEffects ? 1 : [1, 1.5]}
        >
          <color attach="background" args={["#07111f"]} />
          <FlightScene flight={flight} cameraMode={cameraMode} lowEffects={settings.lowEffects} />
          <AdaptiveQuality />
          {!settings.lowEffects && (
            <EffectComposer>
              <Bloom intensity={0.6} luminanceThreshold={0.35} luminanceSmoothing={0.2} mipmapBlur />
            </EffectComposer>
          )}
        </SafeCanvas>

        {/* HUD overlay */}
        {sample && (
          <div className="hud">
            <HudReadout label="TIME" value={formatTime(sample.tS)} />
            <HudReadout label="ALTITUDE" value={sample.altitudeKm.toFixed(1)} unit="km" />
            <HudReadout label="SPEED" value={(sample.speedMs / 1000).toFixed(2)} unit="km/s" />
            <HudReadout label="FUEL" value={(sample.propellantKg / 1000).toFixed(1)} unit="t" />
            <HudReadout label="G-LOAD" value={sample.properAccelG.toFixed(2)} unit="g" />
            <HudReadout label="DYN PRESS" value={(sample.dynamicPressurePa / 1000).toFixed(1)} unit="kPa" />
            <HudReadout label="PHASE" value={PHASE_NAMES[sample.phase] ?? "?"} />
          </div>
        )}

        {/* Event timeline */}
        <div className="timeline">
          <div className="timeline-track">
            {flight.events.map((e, i) => (
              <div
                key={i}
                className={`timeline-event${playbackClock.timeS >= e.t ? " past" : ""}`}
                style={{ left: `${(e.t / duration) * 100}%` }}
                title={`${e.id} @ ${formatTime(e.t)}`}
              />
            ))}
            <div className="timeline-progress" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="playback-bar">
        <button onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={playbackSpeed === s ? "active" : ""}
            onClick={() => setPlaybackSpeed(s)}
          >
            {s}×
          </button>
        ))}
        <input
          type="range"
          className="scrubber"
          min={0}
          max={duration}
          step={0.05}
          value={playbackClock.timeS}
          onChange={(e) => {
            playbackClock.timeS = Number(e.target.value);
          }}
          aria-label="Scrub flight"
        />
        <div className="camera-modes">
          {CAMERAS.map((c) => (
            <button
              key={c.id}
              className={cameraMode === c.id ? "active" : ""}
              onClick={() => setCameraMode(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button className="debrief-btn" onClick={() => setScreen("debrief")}>
          DEBRIEF →
        </button>
      </div>
    </div>
  );
}
