/**
 * Central application store (zustand). High-frequency playback position is
 * deliberately absent: PlaybackController owns it and the renderer reads it
 * every animation frame, so it never causes a React render.
 */

import { create } from "zustand";

import { referenceConfig, type RocketConfig } from "../domain/config";
import { deriveRocket, type DerivedRocket } from "../domain/derive";
import { createEngineCatalog } from "../domain/engines";
import { MODEL_VERSION } from "../domain/version";
import {
  isAnalysisStale,
  loadBuild,
  loadRunSummaries,
  loadSettings,
  pushRunSummary,
  saveBuild,
  saveSettings,
  type RunSummary,
  type Settings,
} from "../persistence/storage";
import { defaultEnvironment } from "../sim/ascent/flight";
import { referenceSnapshot, type WeatherSnapshot } from "../sim/orbital/weather";
import { SimClient } from "../workers/client";
import { serializeFlightInput, type SerializableFlightResult } from "../workers/serialize";
import type { RecommendedExperiment } from "../sim/outcomes/types";

export type Screen = "assembly" | "flight" | "debrief";
export type CameraMode = "overhead" | "chase" | "ground" | "orbit";

const catalog = createEngineCatalog();
const simClient = new SimClient();

export function deriveCurrent(config: RocketConfig): DerivedRocket {
  return deriveRocket(config, catalog);
}

interface AppStore {
  screen: Screen;
  config: RocketConfig;
  derived: DerivedRocket;
  settings: Settings;
  weather: WeatherSnapshot;
  runSummaries: RunSummary[];
  /** True when the config changed since the last recorded run. */
  analysisStale: boolean;
  experimentBaseline: RunSummary | null;
  suggestedExperiment: RecommendedExperiment | null;
  persistenceNotice: string | null;

  flight: SerializableFlightResult | null;
  flightLoading: boolean;
  flightError: string | null;

  playing: boolean;
  playbackSpeed: number;
  cameraMode: CameraMode;
  /** 1 = close rocket framing. Larger values pull back; still centered on the vehicle. */
  cameraZoom: number;

  setScreen: (screen: Screen) => void;
  updateConfig: (patch: Partial<RocketConfig>) => void;
  resetToReference: () => void;
  setSettings: (patch: Partial<Settings>) => void;
  setWeather: (weather: WeatherSnapshot) => void;
  launch: () => Promise<void>;
  cancelFlight: () => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setCameraMode: (mode: CameraMode) => void;
  setCameraZoom: (zoom: number) => void;
  returnToBuild: () => void;
  startExperiment: (baseline: RunSummary, suggestion: RecommendedExperiment) => void;
}

const MIN_CAMERA_ZOOM = 0.0005;
const MAX_CAMERA_ZOOM = 6;

let activeFlightRunId: number | null = null;

export const useAppStore = create<AppStore>((set, get) => {
  const initialConfig = loadBuild() ?? referenceConfig();
  const initialSummaries = loadRunSummaries();

  return {
    screen: "assembly",
    config: initialConfig,
    derived: deriveCurrent(initialConfig),
    settings: loadSettings(),
    weather: referenceSnapshot(),
    runSummaries: initialSummaries,
    analysisStale: isAnalysisStale(initialConfig, initialSummaries[0] ?? null),
    experimentBaseline: null,
    suggestedExperiment: null,
    persistenceNotice: null,

    flight: null,
    flightLoading: false,
    flightError: null,

    playing: true,
    playbackSpeed: 1,
    cameraMode: "overhead",
    cameraZoom: 1,

    setScreen: (screen) => set({ screen }),

    updateConfig: (patch) => {
      const config = { ...get().config, ...patch, modelVersion: MODEL_VERSION };
      saveBuild(config);
      set({
        config,
        derived: deriveCurrent(config),
        analysisStale: isAnalysisStale(config, get().runSummaries[0] ?? null),
      });
    },

    resetToReference: () => {
      const config = referenceConfig();
      saveBuild(config);
      set({
        config,
        derived: deriveCurrent(config),
        analysisStale: isAnalysisStale(config, get().runSummaries[0] ?? null),
      });
    },

    setSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      saveSettings(settings);
      set({ settings });
    },

    setWeather: (weather) => set({ weather }),

    launch: async () => {
      const { config, weather } = get();
      const derived = deriveCurrent(config);
      if (derived.checks.some((c) => c.severity === "error")) {
        set({ flightError: "Resolve build errors before launch." });
        return;
      }
      get().cancelFlight();
      set({ flightLoading: true, flightError: null, flight: null });

      const input = serializeFlightInput(config, defaultEnvironment(weather), Math.floor(Math.random() * 1e9));
      const { promise, runId } = simClient.runFlight(input);
      activeFlightRunId = runId;
      try {
        const result = await promise;
        if (activeFlightRunId !== runId) {
          return; // superseded
        }
        activeFlightRunId = null;
        const summary: RunSummary = {
          id: `${Date.now()}-${result.seed}`,
          timestamp: new Date().toISOString(),
          config,
          outcome: result.outcome,
          orbitAchieved: result.orbitAchieved,
          targetOrbitAchieved: result.targetOrbitAchieved,
          maxQPa: result.maxQPa,
          maxG: result.maxG,
          // The parking orbit, not `finalElements`: a lunar-outcome flight's
          // `finalElements` describes the trans-lunar trajectory instead
          // (LUNAR_MISSION_PLAN.md §2.1). `parkingElements` is set exactly
          // when `orbitAchieved` is true.
          perigeeKm: result.parkingElements?.perigeeAltitudeKm ?? result.finalElements?.perigeeAltitudeKm ?? null,
          apogeeKm: result.parkingElements?.apogeeAltitudeKm ?? result.finalElements?.apogeeAltitudeKm ?? null,
          modelVersion: result.modelVersion,
          catalogVersion: result.catalogVersion,
          guidanceVersion: result.guidanceVersion,
          seed: result.seed,
          assessment: result.assessment,
          lunarTransfer: result.lunarTransfer,
          ...(get().experimentBaseline ? { baselineRunId: get().experimentBaseline!.id } : {}),
        };
        const saved = pushRunSummary(summary);
        set({
          flight: result,
          flightLoading: false,
          screen: "flight",
          playing: true,
          cameraZoom: 1,
          runSummaries: saved.runs,
          analysisStale: false,
          persistenceNotice: saved.persisted ? null : "This run is available for comparison until you reload, but browser storage could not save it.",
          experimentBaseline: null,
          suggestedExperiment: null,
        });
      } catch (error) {
        if (activeFlightRunId === runId) {
          activeFlightRunId = null;
          set({ flightLoading: false, flightError: error instanceof Error ? error.message : String(error) });
        }
      }
    },

    cancelFlight: () => {
      if (activeFlightRunId !== null) {
        simClient.cancelFlight(activeFlightRunId);
        activeFlightRunId = null;
      }
      set({ flightLoading: false });
    },

    setPlaying: (playing) => set({ playing }),
    setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
    setCameraMode: (cameraMode) => set({ cameraMode }),
    setCameraZoom: (zoom) =>
      set({ cameraZoom: Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom)) }),

    returnToBuild: () => {
      set({ screen: "assembly", flight: null, playing: false });
    },

    startExperiment: (baseline, suggestion) => {
      set({
        screen: "assembly",
        flight: null,
        playing: false,
        experimentBaseline: baseline,
        suggestedExperiment: suggestion,
      });
    },
  };
});

export { simClient };
