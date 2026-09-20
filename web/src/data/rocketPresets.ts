import data from "./rocket-presets.json";
import type { RocketConfig } from "../domain/config";

export interface RocketPreset {
  id: string;
  name: string;
  summary: string;
  settings: Omit<RocketConfig, "modelVersion">;
}

export const ROCKET_PRESETS = data as RocketPreset[];
