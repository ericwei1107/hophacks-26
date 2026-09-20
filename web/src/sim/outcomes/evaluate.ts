import type { DerivedRocket } from "../../domain/derive";
import type { FlightOutcome } from "../ascent/flight";
import { assessSpaceWeatherEffects, type WeatherSnapshot } from "../orbital/weather";
import { ASSESSMENT_VERSION, type Diagnosis, type EnvironmentalCause, type FlightAssessment, type FlightEvidence, type MetricAssessment } from "./types";

const diagnosisByOutcome: Partial<Record<FlightOutcome, Omit<Diagnosis, "evidence">>> = {
  insufficient_liftoff_thrust: { id: "underpowered", title: "INSUFFICIENT LIFTOFF THRUST", explanation: "The rocket could not leave the pad because liftoff thrust was below its weight.", recommendedExperiment: { control: "stage1EngineCount", direction: "increase", metric: "liftoff_twr", label: "Add a stage-1 engine" } },
  insufficient_orbital_energy: { id: "fuel_hog", title: "INSUFFICIENT ORBITAL ENERGY", explanation: "The upper stage ran out of usable energy before a sustainable orbit.", recommendedExperiment: { control: "stage2PropellantKg", direction: "increase", metric: "ideal_delta_v", label: "Add stage-2 propellant" } },
  acceleration_limit: { id: "overpowered_stack", title: "ACCELERATION LIMIT EXCEEDED", explanation: "The payload exceeded its 5 g game-rule limit.", recommendedExperiment: { control: "stage1EngineCount", direction: "decrease", metric: "peak_g", label: "Use fewer stage-1 engines" } },
  dynamic_pressure_limit: { id: "max_q_overload", title: "MAX-Q STRUCTURAL FAILURE", explanation: "Aerodynamic loading exceeded the 45 kPa structural game-rule limit.", recommendedExperiment: { control: "stage1EngineCount", direction: "decrease", metric: "liftoff_twr", label: "Reduce stage-1 engine count" } },
  aerodynamic_instability: { id: "static_stability_limit", title: "STATIC STABILITY LIMIT", explanation: "The simplified game stability rule was exceeded while the first stage was in the atmosphere.", recommendedExperiment: { control: "finSpanM", direction: "increase", metric: "static_margin", label: "Increase fin span" } },
  slenderness_limit: { id: "pencil", title: "STRUCTURAL SLENDERNESS LIMIT", explanation: "The stack is too long for its diameter under the current structural game rule.", recommendedExperiment: { control: "diameterM", direction: "increase", metric: "drag_area", label: "Increase body diameter" } },
  vacuum_engine_low_ignition: { id: "upper_stage_ignition", title: "UPPER-STAGE IGNITION TOO LOW", explanation: "The vacuum engine reached its minimum ignition altitude too late.", recommendedExperiment: { control: "stage1EngineCount", direction: "increase", metric: "liftoff_twr", label: "Add stage-1 engine capability" } },
  sustained_orbit: { id: "off_target_orbit", title: "ORBIT ACHIEVED OFF TARGET", explanation: "The payload reached a sustained orbit outside the target corridor.", recommendedExperiment: { control: "stage2PropellantKg", direction: "change", metric: "ideal_delta_v", label: "Adjust stage-2 propellant" } },
  // Lunar-mission outcomes (LUNAR_MISSION_PLAN.md §5). `lunar_arrival` needs
  // no diagnosis — it is the successful case. `lunar_impact`/`lunar_miss`
  // are left undiagnosed too: their cause is burn-aim dispersion, which
  // this game does not model or let a player control, so recommending a
  // build change for them would fabricate a lever that doesn't exist.
  tli_shortfall: { id: "weak_upper_stage", title: "STRANDED IN PARKING ORBIT", explanation: "The upper stage reached a sustained parking orbit but ran out of usable delta-v before completing trans-lunar injection.", recommendedExperiment: { control: "stage2Engine", direction: "change", metric: "ideal_delta_v", label: "Use the cryogenic upper-stage engine" } },
  earth_escape: { id: "overshoot", title: "TRANS-LUNAR OVERSHOOT", explanation: "The trans-lunar injection burn carried far more energy than the transfer needed, missing the Moon on the far side.", recommendedExperiment: { control: "stage2PropellantKg", direction: "decrease", metric: "ideal_delta_v", label: "Reduce stage-2 propellant" } },
};

function metric(id: MetricAssessment["id"], label: string, value: number | null, unit: string, band: MetricAssessment["band"], threshold: string, hint: string): MetricAssessment {
  return { id, label, value, unit, band, threshold, hint };
}

export function evaluateFlightOutcome(
  rocket: DerivedRocket,
  rawOutcome: FlightOutcome,
  evidence: FlightEvidence,
  weather?: WeatherSnapshot,
): FlightAssessment {
  const metrics: MetricAssessment[] = [
    metric("liftoff_twr", "Liftoff TWR", rocket.liftoffTwr, "ratio", rocket.liftoffTwr <= 1 ? "outside_limit" : rocket.liftoffTwr < 1.15 ? "marginal" : "within_range", "must exceed 1.00", "Low thrust-to-weight delays or prevents liftoff."),
    // Lunar requirement (LUNAR_MISSION_PLAN.md §2.2): a Hohmann-style
    // trans-lunar transfer from a ~200 km parking orbit needs roughly
    // 12.4-12.7 km/s of ideal delta-v on top of reaching orbit at all.
    metric("ideal_delta_v", "Ideal Δv", rocket.totalIdealDeltaVMs, "m/s", rocket.totalIdealDeltaVMs < 12_400 ? "outside_limit" : rocket.totalIdealDeltaVMs < 12_700 ? "marginal" : "within_range", "12.40 km/s lunar planning floor", "More ideal delta-v gives the fixed guidance more margin for trans-lunar injection, not just orbit."),
    metric("drag_area", "Drag area CdA", rocket.dragAreaM2, "m²", "context_only", "context only", "Drag area affects losses with mass, atmosphere, and trajectory; it has no universal pass/fail value."),
    metric("static_margin", "Static margin", rocket.staticMargin, "cal", rocket.staticMargin < 1 ? "outside_limit" : rocket.staticMargin < 1.15 ? "marginal" : "within_range", "simplified limit: 1.00 cal", "This is a simplified stability game rule, not a control-authority simulation."),
    metric("peak_g", "Peak g", evidence.maxG, "g", evidence.maxG > 5 ? "outside_limit" : evidence.maxG > 4.5 ? "marginal" : "within_range", "payload limit: 5.00 g", "Measured during flight."),
  ];
  const template = diagnosisByOutcome[rawOutcome];
  const primaryDiagnosis = template ? { ...template, evidence: rawOutcome === "aerodynamic_instability" ? "Observed terminal result under the simplified static-margin rule." : `Observed terminal result: ${rawOutcome.replaceAll("_", " ")}.` } : null;
  const effects = weather?.effects ?? (weather ? assessSpaceWeatherEffects(weather.weather) : null);
  const environmentalCauses: EnvironmentalCause[] = effects?.causes ?? [];
  return { assessmentVersion: ASSESSMENT_VERSION, rawOutcome, metrics, evidence, primaryDiagnosis, contributingDiagnoses: [], environmentalCauses };
}
