/**
 * Flight screen: the launch view plus the HUD, event timeline and playback
 * controls. No piloting controls — the autopilot flew the recorded trajectory.
 *
 * The launch view is whichever renderer `selectRenderer` picked; everything
 * else on this screen is HTML layered over it, reading from the
 * PlaybackController rather than from the renderer. That is what makes the
 * three.js and Unity views interchangeable: swapping them changes the picture
 * and nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { IGNITION_HOLD_S, PlaybackController } from "../../playback/PlaybackController";
import type { LaunchRenderer } from "../../renderers/LaunchRenderer";
import { selectRenderer } from "../../renderers/selectRenderer";
import { useAppStore, type CameraMode } from "../store";
import { PHASE_NAMES, type FlightSample } from "../telemetry";
import { NarratedText } from "../../narration/NarratedText";

const SPEEDS = [1, 5, 20];
const HUD_MIN_INTERVAL_MS = 50;
const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "overhead", label: "Overhead" },
  { id: "chase", label: "Chase" },
  { id: "ground", label: "Ground" },
  { id: "orbit", label: "Orbit" },
];

/** Radians of camera swing per pixel dragged. */
const DRAG_SENSITIVITY = 0.006;

/** Callout text for flight events as they are crossed. */
const EVENT_LABELS: Record<string, string> = {
  liftoff: "LIFTOFF",
  max_q: "MAX-Q",
  stage1_burnout: "MAIN ENGINE CUTOFF",
  separation: "STAGE SEPARATION",
  stage2_ignition: "STAGE 2 IGNITION",
  fairing_jettison: "FAIRING JETTISON",
  stage2_burnout: "STAGE 2 BURNOUT",
  stage2_cutoff: "STAGE 2 CUTOFF",
  orbit_cutoff: "ORBIT INSERTION",
  orbit_achieved: "ORBIT ACHIEVED",
  circularization_ignition: "CIRCULARIZATION BURN",
  tli_cutoff: "TRANS-LUNAR INJECTION",
  failed: "FLIGHT FAILED",
};

/** Short labels drawn on the timeline itself, for the events worth a tick mark. */
const TIMELINE_LABELS: Record<string, string> = {
  max_q: "MAX-Q",
  separation: "SEP",
  fairing_jettison: "FAIRING",
  orbit_cutoff: "ORBIT",
  orbit_achieved: "ORBIT",
  failed: "FAIL",
};

/**
 * Minimum gap between two timeline labels, as a percentage of the track.
 * Staging events land within seconds of each other on a flight that lasts
 * minutes, so without this their labels print on top of one another.
 */
const MIN_LABEL_GAP_PCT = 6;

const TOAST_MS = 3200;

/**
 * Which events get a printed label: the first of any cluster, and never the
 * same word twice (orbit cutoff and orbit achieved share an instant). Every
 * event still gets its tick mark and its hover title.
 */
function labelledEventIndices(events: { t: number; id: string }[], duration: number): Set<number> {
  if (duration <= 0) {
    return new Set();
  }
  const order = events
    .map((event, index) => ({ index, t: event.t, label: TIMELINE_LABELS[event.id] }))
    .filter((entry) => entry.label !== undefined)
    .sort((a, b) => a.t - b.t);

  const kept = new Set<number>();
  const seen = new Set<string>();
  let lastPct = -Infinity;
  for (const entry of order) {
    const pct = (entry.t / duration) * 100;
    if (seen.has(entry.label!) || pct - lastPct < MIN_LABEL_GAP_PCT) {
      continue;
    }
    kept.add(entry.index);
    seen.add(entry.label!);
    lastPct = pct;
  }
  return kept;
}

function formatTime(s: number): string {
  const neg = s < 0;
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.floor(abs % 60);
  return `${neg ? "T-" : "T+"}${m}:${sec.toString().padStart(2, "0")}`;
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

interface Toast {
  key: number;
  title: string;
  detail: string | null;
}

export function FlightScreen() {
  const {
    flight,
    playing,
    playbackSpeed,
    cameraMode,
    cameraZoom,
    settings,
    setPlaying,
    setPlaybackSpeed,
    setCameraMode,
    setCameraZoom,
    setScreen,
  } = useAppStore(
    useShallow((s) => ({
      flight: s.flight,
      playing: s.playing,
      playbackSpeed: s.playbackSpeed,
      cameraMode: s.cameraMode,
      cameraZoom: s.cameraZoom,
      settings: s.settings,
      setPlaying: s.setPlaying,
      setPlaybackSpeed: s.setPlaybackSpeed,
      setCameraMode: s.setCameraMode,
      setCameraZoom: s.setCameraZoom,
      setScreen: s.setScreen,
    })),
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const rendererRef = useRef<LaunchRenderer | null>(null);

  const [sample, setSample] = useState<FlightSample | null>(null);
  const [timeS, setTimeS] = useState(-IGNITION_HOLD_S);
  const [rendererId, setRendererId] = useState<"three" | "unity" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number>(0);

  // --- controller: owns the clock, feeds the renderer and this HUD ---------
  useEffect(() => {
    if (!flight) {
      return;
    }
    const controller = new PlaybackController(flight);
    controllerRef.current = controller;
    let lastHudMs = 0;
    const unsubscribe = controller.subscribe((nextSample, frame) => {
      const now = performance.now();
      if (!frame.discontinuity && now - lastHudMs < HUD_MIN_INTERVAL_MS) {
        return;
      }
      lastHudMs = now;
      setSample(nextSample);
      setTimeS(controller.timeS);
      if (frame.events.length > 0) {
        // Announce the most significant event crossed this frame.
        const id = [...frame.events].reverse().find((e) => EVENT_LABELS[e] !== undefined);
        if (id) {
          const record = flight.events.find((e) => e.id === id && Math.abs(e.t - frame.t) < 2);
          setToast({ key: Date.now(), title: EVENT_LABELS[id]!, detail: record?.detail ?? null });
          window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
        }
      }
    });
    const unsubscribeComplete = controller.subscribeComplete(() => {
      setPlaying(false);
      setScreen("debrief");
    });
    controller.setPlaying(useAppStore.getState().playing);
    controller.setSpeed(useAppStore.getState().playbackSpeed);
    controller.start();
    return () => {
      unsubscribe();
      unsubscribeComplete();
      controller.dispose();
      controllerRef.current = null;
      window.clearTimeout(toastTimer.current);
    };
  }, [flight, setPlaying, setScreen]);

  // --- renderer: mounted lazily, once a flight exists ----------------------
  useEffect(() => {
    const container = viewportRef.current;
    if (!flight || !container) {
      return;
    }
    let disposed = false;
    let mounted: LaunchRenderer | null = null;

    void selectRenderer({
      container,
      flight,
      lowEffects: settings.lowEffects,
      reducedMotion: settings.reducedMotion,
      cameraMode: useAppStore.getState().cameraMode,
      zoom: useAppStore.getState().cameraZoom,
      onProgress: setProgress,
    }).then((selection) => {
      if (disposed) {
        selection.renderer.dispose();
        return;
      }
      mounted = selection.renderer;
      rendererRef.current = selection.renderer;
      setRendererId(selection.id);
      setNotice(selection.notice);
      setProgress(1);
      controllerRef.current?.setRenderer(selection.renderer);
    });

    return () => {
      disposed = true;
      controllerRef.current?.setRenderer(null);
      rendererRef.current = null;
      mounted?.dispose();
    };
    // The renderer is rebuilt only for a new flight or an effects setting
    // change; camera state is pushed into it imperatively.
  }, [flight, settings.lowEffects, settings.reducedMotion]);

  // Suspend playback while the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }
      if (document.hidden) {
        controller.stop();
      } else {
        controller.start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    controllerRef.current?.setPlaying(playing);
  }, [playing]);

  useEffect(() => {
    controllerRef.current?.setSpeed(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    rendererRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  // --- camera input, captured here so the HUD never blocks it --------------
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    rendererRef.current?.orbitCamera(-dx * DRAG_SENSITIVITY, dy * DRAG_SENSITIVITY);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const applyZoom = useCallback(
    (factor: number) => {
      rendererRef.current?.zoomCamera(factor);
      setCameraZoom(useAppStore.getState().cameraZoom * factor);
    },
    [setCameraZoom],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      applyZoom(event.deltaY > 0 ? 1 / 1.15 : 1.15);
    },
    [applyZoom],
  );

  const labelled = useMemo(
    () => labelledEventIndices(flight?.events ?? [], flight?.totalTimeS ?? 0),
    [flight],
  );

  if (!flight) {
    return (
      <div className="screen flight">
        <NarratedText>No flight loaded.</NarratedText>
        <button onClick={() => setScreen("assembly")}>Back to build</button>
      </div>
    );
  }

  const duration = flight.totalTimeS;
  const progressFraction = duration > 0 ? Math.max(0, timeS) / duration : 0;

  return (
    <div className="screen flight">
      <div
        className="viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        {rendererId === null && (
          <div className="renderer-loading">
            <span className="renderer-loading-label">Loading launch view…</span>
            <div className="renderer-loading-track">
              <div className="renderer-loading-bar" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}

        {notice && (
          <div className="renderer-notice" role="status">
            {notice}
            <button className="renderer-notice-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {/* HUD overlay */}
        {sample && (
          <div className="hud">
            <div className="hud-item hud-time">
              <span className="hud-label">Mission time</span>
              <span className="hud-value">{formatTime(timeS)}</span>
            </div>
            <HudReadout label="Altitude" value={sample.altitudeKm.toFixed(1)} unit="km" />
            <HudReadout label="Speed" value={(sample.speedMs / 1000).toFixed(2)} unit="km/s" />
            <HudReadout label="Fuel" value={(sample.propellantKg / 1000).toFixed(1)} unit="t" />
            <HudReadout label="G-load" value={sample.properAccelG.toFixed(2)} unit="g" />
            <HudReadout label="Dyn press" value={(sample.dynamicPressurePa / 1000).toFixed(1)} unit="kPa" />
            <HudReadout label="Phase" value={PHASE_NAMES[sample.phase] ?? "?"} />
          </div>
        )}

        {toast && (
          <div className="event-toast" key={toast.key} role="status">
            <span className="event-toast-title">{toast.title}</span>
            {toast.detail && <span className="event-toast-detail">{toast.detail}</span>}
          </div>
        )}

        {/* Event timeline */}
        <div className="timeline">
          <div className="timeline-track">
            {flight.events.map((e, i) => (
              <div
                key={i}
                className={`timeline-event${timeS >= e.t ? " past" : ""}`}
                style={{ left: `${(e.t / duration) * 100}%` }}
                title={`${e.id} @ ${formatTime(e.t)}`}
              >
                {labelled.has(i) && <span className="timeline-label">{TIMELINE_LABELS[e.id]}</span>}
              </div>
            ))}
            <div className="timeline-progress" style={{ width: `${progressFraction * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="playback-bar">
        <button className="play-btn" onClick={() => setPlaying(!playing)}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <div className="segmented" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} className={playbackSpeed === s ? "active" : ""} onClick={() => setPlaybackSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <input
          type="range"
          className="scrubber"
          min={0}
          max={duration}
          step={0.05}
          value={Math.max(0, timeS)}
          onChange={(e) => controllerRef.current?.seek(Number(e.target.value))}
          aria-label="Scrub flight"
        />
        <div className="zoom-controls">
          <button aria-label="Zoom out from rocket" title="Zoom out" onClick={() => applyZoom(1 / 1.6)}>
            −
          </button>
          <span className="zoom-readout">
            {cameraZoom >= 1 ? cameraZoom.toFixed(1) : cameraZoom.toFixed(2)}×
          </span>
          <button aria-label="Zoom in on rocket" title="Zoom in" onClick={() => applyZoom(1.6)}>
            +
          </button>
        </div>
        <div className="segmented camera-modes" role="group" aria-label="Camera">
          {CAMERAS.map((c) => (
            <button key={c.id} className={cameraMode === c.id ? "active" : ""} onClick={() => setCameraMode(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        {rendererId && (
          <span className="renderer-badge" title="Active launch renderer">
            {rendererId === "unity" ? "UNITY" : "THREE"}
          </span>
        )}
        <button className="debrief-btn" onClick={() => setScreen("debrief")}>
          DEBRIEF →
        </button>
      </div>
    </div>
  );
}
