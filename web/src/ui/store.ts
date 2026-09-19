/**
 * Central application store (zustand). High-frequency telemetry playback
 * position is kept out of React state (see playbackClock) per R3F performance
 * guidance.
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

  flight: SerializableFlightResult | null;
  flightLoading: boolean;
  flightError: string | null;

  playing: boolean;
  playbackSpeed: number;
  cameraMode: CameraMode;

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
  returnToBuild: () => void;
}

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

    flight: null,
    flightLoading: false,
    flightError: null,

    playing: true,
    playbackSpeed: 1,
    cameraMode: "overhead",

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
          perigeeKm: result.finalElements?.perigeeAltitudeKm ?? null,
          apogeeKm: result.finalElements?.apogeeAltitudeKm ?? null,
          modelVersion: result.modelVersion,
          catalogVersion: result.catalogVersion,
          guidanceVersion: result.guidanceVersion,
          seed: result.seed,
        };
        const runSummaries = pushRunSummary(summary);
        set({
          flight: result,
          flightLoading: false,
          screen: "flight",
          playing: true,
          runSummaries,
          analysisStale: false,
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

    returnToBuild: () => {
      set({ screen: "assembly", flight: null, playing: false });
    },
  };
});

export { simClient };
