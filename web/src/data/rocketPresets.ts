import presetData from "./rocket-presets.json";
import {
  ROCKET_CONFIG_PRESET_KEYS,
  type RocketConfig,
  type RocketPresetSettingKey,
} from "../domain/config";

export type PresetTier = "collegiate" | "sounding" | "orbital" | "historical";
export type PresetStatus = "VERIFIED" | "UNVERIFIED";

export interface RocketPreset {
  id: string;
  name: string;
  tier: PresetTier;
  summary: string;
  status: PresetStatus;
  sources: { label: string; url: string }[];
  settings: Partial<Pick<RocketConfig, RocketPresetSettingKey>>;
}

const VALID_TIERS: readonly PresetTier[] = ["collegiate", "sounding", "orbital", "historical"];
const VALID_STATUSES: readonly PresetStatus[] = ["VERIFIED", "UNVERIFIED"];
const presetKeys = new Set<string>(ROCKET_CONFIG_PRESET_KEYS);

/** Throws for malformed static data. Vite calls this during build setup too. */
export function validateRocketPresets(data: unknown): asserts data is RocketPreset[] {
  if (!Array.isArray(data)) throw new Error("rocket-presets.json must contain an array.");
  const ids = new Set<string>();
  for (const preset of data) {
    if (!preset || typeof preset !== "object") throw new Error("Each rocket preset must be an object.");
    const record = preset as Record<string, unknown>;
    if (typeof record["id"] !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record["id"]) || ids.has(record["id"])) {
      throw new Error(`Rocket preset has an invalid or duplicate id: ${String(record["id"])}.`);
    }
    ids.add(record["id"]);
    if (typeof record["name"] !== "string" || typeof record["summary"] !== "string") throw new Error(`Rocket preset ${record["id"]} needs name and summary.`);
    if (!VALID_TIERS.includes(record["tier"] as PresetTier)) throw new Error(`Rocket preset ${record["id"]} has an invalid tier.`);
    if (!VALID_STATUSES.includes(record["status"] as PresetStatus)) throw new Error(`Rocket preset ${record["id"]} has an invalid status.`);
    if (!Array.isArray(record["sources"]) || !record["sources"].every((source) => {
      const s = source as Record<string, unknown>;
      return s && typeof s["label"] === "string" && typeof s["url"] === "string" && /^https:\/\//.test(s["url"]);
    })) throw new Error(`Rocket preset ${record["id"]} has invalid sources.`);
    if (!record["settings"] || typeof record["settings"] !== "object" || Array.isArray(record["settings"])) throw new Error(`Rocket preset ${record["id"]} needs a settings object.`);
    for (const key of Object.keys(record["settings"])) {
      if (!presetKeys.has(key)) throw new Error(`Rocket preset ${record["id"]} has unknown settings key: ${key}.`);
    }
  }
}

validateRocketPresets(presetData);
export const ROCKET_PRESETS: readonly RocketPreset[] = presetData;

export function findRocketPreset(id: string | null): RocketPreset | undefined {
  return id ? ROCKET_PRESETS.find((preset) => preset.id === id) : undefined;
}
