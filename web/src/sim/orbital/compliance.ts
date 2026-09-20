/**
 * Deorbit-compliance screening, ported from regulations.py's
 * `evaluate_mission_compliance`.
 *
 * This is the static five-year rule only — the Federal Register document
 * lookup (`get_latest_debris_rules`) is a live network call and is
 * deliberately not ported here, so this check always works offline and with
 * no external dependency, matching the rest of the TS mission model.
 */

/** FAA/FCC orbital-debris post-mission disposal screening limit, years. */
export const DEORBIT_LIMIT_YEARS = 5;

export interface DebrisComplianceResult {
  missionName: string;
  compliant: boolean;
  violations: string[];
}

/**
 * Evaluate the five-year post-mission disposal rule.
 *
 * `postMissionDecayYears` is a screening input, not a physical estimate: the
 * mission model does not compute a separate post-disposal decay time, so the
 * mission's own lifespan is used as the proxy (same convention as the Python
 * reference's `main.py`).
 */
export function evaluateDeorbitCompliance(
  missionName: string,
  postMissionDecayYears: number,
): DebrisComplianceResult {
  if (!Number.isFinite(postMissionDecayYears)) {
    return {
      missionName,
      compliant: false,
      violations: ["post_mission_decay_years must be a numeric value in years."],
    };
  }
  if (postMissionDecayYears > DEORBIT_LIMIT_YEARS) {
    const over = postMissionDecayYears - DEORBIT_LIMIT_YEARS;
    return {
      missionName,
      compliant: false,
      violations: [
        `Post-mission disposal is ${postMissionDecayYears.toFixed(1)} years, exceeding the ` +
          `${DEORBIT_LIMIT_YEARS}-year de-orbit limit by ${over.toFixed(1)} years.`,
      ],
    };
  }
  return { missionName, compliant: true, violations: [] };
}
