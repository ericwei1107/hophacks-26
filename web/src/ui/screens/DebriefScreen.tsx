/**
 * Debrief screen: outcome and primary cause first, evidence, synchronized
 * plots, replay/rebuild actions, and optional payload mission + robustness
 * analysis.
 */

import { useMemo, useState } from "react";

import { analyzePayload, createPayloadHandoff, type PayloadAnalysis } from "../../sim/orbital/payload";
import type { MonteCarloSummary } from "../../sim/orbital/types";
import type { AscentRobustnessResult } from "../../sim/ascent/robustness";
import { useAppStore, simClient } from "../store";
import { TelemetryChart, type ChartChannel } from "../components/TelemetryChart";
import type { FlightOutcome } from "../../sim/ascent/flight";

const OUTCOME_PRESENTATION: Record<FlightOutcome, { title: string; suggestion: string }> = {
  target_orbit: { title: "TARGET ORBIT ACHIEVED", suggestion: "The payload is in the target corridor. Run the payload mission analysis to check three-year survival." },
  sustained_orbit: { title: "ORBIT ACHIEVED (OFF-TARGET)", suggestion: "A safe bound orbit outside the target corridor. The autopilot did its best with this build's energy margin." },
  low_perigee: { title: "ORBIT NOT SUSTAINED", suggestion: "Perigee below 150 km: the orbit decays. More upper-stage capability would help." },
  unbound_trajectory: { title: "TRAJECTORY UNBOUND", suggestion: "The vehicle escaped instead of closing its orbit. Less upper-stage burn or an earlier cutoff." },
  insufficient_orbital_energy: { title: "INSUFFICIENT ORBITAL ENERGY", suggestion: "The upper stage exhausted before reaching a sustainable orbit and the vehicle reentered. Add upper-stage propellant or a more capable first stage." },
  impact: { title: "GROUND IMPACT", suggestion: "The vehicle came back down. Check the trajectory and staging." },
  invalid_build: { title: "INVALID BUILD", suggestion: "Resolve the build errors before launch." },
  insufficient_liftoff_thrust: { title: "INSUFFICIENT LIFTOFF THRUST", suggestion: "Thrust-to-weight below 1: the vehicle cannot leave the pad. Add engines or reduce mass." },
  acceleration_limit: { title: "ACCELERATION LIMIT EXCEEDED", suggestion: "Even at minimum throttle the vehicle exceeded 5 g. A lower-thrust upper-stage engine or heavier upper stack." },
  dynamic_pressure_limit: { title: "MAX-Q STRUCTURAL FAILURE", suggestion: "Dynamic pressure exceeded 45 kPa. A gentler build (less liftoff thrust) or a narrower body reduces peak dynamic pressure." },
  aerodynamic_instability: { title: "AERODYNAMIC INSTABILITY", suggestion: "Center of pressure ahead of center of mass in the atmosphere. Increase fin span." },
  slenderness_limit: { title: "STRUCTURAL FAILURE (SLENDERNESS)", suggestion: "The stack is too long for its diameter. Increase diameter or shorten the tanks." },
  vacuum_engine_low_ignition: { title: "VACUUM ENGINE IGNITED TOO LOW", suggestion: "This engine needs ~60 km. Use a sea-level upper-stage engine or a more capable first stage." },
  timeout: { title: "SIMULATION TIMEOUT", suggestion: "The flight did not reach a terminal state in time." },
};

function outcomeTitle(outcome: FlightOutcome): string {
  return OUTCOME_PRESENTATION[outcome]?.title ?? outcome;
}

export function DebriefScreen() {
  const { flight, setScreen, returnToBuild } = useAppStore();
  const [hoverTimeS, setHoverTimeS] = useState<number | null>(null);
  const [payloadAnalysis, setPayloadAnalysis] = useState<PayloadAnalysis | null>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloSummary | null>(null);
  const [robustness, setRobustness] = useState<AscentRobustnessResult | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);

  const handoff = useMemo(
    () =>
      flight
        ? createPayloadHandoff({
            orbitAchieved: flight.orbitAchieved,
            finalElements: flight.finalElements,
            stage2PropellantRemainingKg: flight.stage2PropellantRemainingKg,
            payloadWetMassKg: flight.config.payloadWetMassKg,
            weather: flight.weather,
            seed: flight.seed,
          })
        : null,
    [flight],
  );

  if (!flight) {
    return (
      <div className="screen debrief">
        <p>No flight to debrief.</p>
        <button onClick={() => setScreen("assembly")}>Back to build</button>
      </div>
    );
  }

  const presentation = OUTCOME_PRESENTATION[flight.outcome];
  const failureEvent = flight.events.find((e) => e.id === "failed");
  const el = flight.finalElements;

  const channels: ChartChannel[] = [
    { label: "Altitude", unit: "km", color: "#63ddeb", value: (t, i) => t.altitudeKm[i] },
    { label: "Speed", unit: "m/s", color: "#9be8a0", value: (t, i) => t.speedMs[i] },
    { label: "Dyn pressure", unit: "kPa", color: "#ff9b54", value: (t, i) => t.dynamicPressurePa[i] / 1000 },
    { label: "G-load", unit: "g", color: "#e87d7d", value: (t, i) => t.properAccelG[i] },
    { label: "Propellant", unit: "t", color: "#c8a2e8", value: (t, i) => t.propellantKg[i] / 1000 },
  ];

  const runPayloadMission = async () => {
    if (!handoff) {
      return;
    }
    const analysis = analyzePayload(handoff);
    setPayloadAnalysis(analysis);
    if (!analysis.mission) {
      return;
    }
    setAnalysisProgress("Monte Carlo…");
    setMonteCarlo(null);
    const { promise } = simClient.runOrbitalMonteCarlo(
      {
        mission: analysis.mission,
        weather: handoff.weather,
        runs: 10_000,
        sensitivityRuns: 1_000,
        seed: handoff.seed,
        rules: "game",
      },
      (completed, total) => setAnalysisProgress(`Monte Carlo ${Math.round((completed / total) * 100)}%`),
    );
    try {
      setMonteCarlo(await promise);
    } catch {
      // canceled
    }
    setAnalysisProgress(null);
  };

  const runRobustness = async () => {
    setAnalysisProgress("Ascent robustness…");
    setRobustness(null);
    const serialized = {
      config: flight.config,
      weather: flight.weather,
      launchLatitudeDeg: 0,
      launchLongitudeDeg: 0,
      localWindEastMs: 0,
      localWindNorthMs: 0,
      seed: flight.seed,
    };
    const { promise } = simClient.runAscentAnalysis(
      { input: serialized, runs: 200, seed: flight.seed },
      (completed, total) => setAnalysisProgress(`Robustness ${Math.round((completed / total) * 100)}%`),
    );
    try {
      setRobustness(await promise);
    } catch {
      // canceled
    }
    setAnalysisProgress(null);
  };

  return (
    <div className="screen debrief">
      <header className={`outcome ${flight.orbitAchieved ? "success" : "failure"}`}>
        <h1>{outcomeTitle(flight.outcome)}</h1>
        {el && (
          <p className="orbit-line">
            Orbit: {el.perigeeAltitudeKm.toFixed(0)} × {el.apogeeAltitudeKm?.toFixed(0) ?? "?"} km, inclination {el.inclinationDeg.toFixed(1)}°
          </p>
        )}
      </header>

      <section className="cause-card">
        <h2>Primary cause</h2>
        <p className="cause-detail">{flight.failureDetail ?? "The flight met its objective."}</p>
        {failureEvent && <p className="cause-time">at {failureEvent.t.toFixed(1)} s</p>}
        <p className="cause-suggestion">{presentation.suggestion}</p>
        <div className="evidence">
          <span>Max-Q {(flight.maxQPa / 1000).toFixed(1)} kPa (limit 45)</span>
          <span>Peak g {flight.maxG.toFixed(2)} (limit 5.0)</span>
          {el && <span>Perigee {el.perigeeAltitudeKm.toFixed(0)} km (sustained ≥ 150)</span>}
        </div>
      </section>

      <section className="plots">
        {channels.map((channel) => (
          <TelemetryChart
            key={channel.label}
            telemetry={flight.telemetry}
            channel={channel}
            events={flight.events}
            hoverTimeS={hoverTimeS}
            onHover={setHoverTimeS}
          />
        ))}
      </section>

      <div className="actions">
        <button onClick={() => setScreen("flight")}>↺ Replay</button>
        <button onClick={returnToBuild}>← Return to build</button>
        {handoff && (
          <button onClick={runPayloadMission} disabled={analysisProgress !== null}>
            Analyze payload mission
          </button>
        )}
        <button onClick={runRobustness} disabled={analysisProgress !== null}>
          Run robustness analysis
        </button>
      </div>
      {analysisProgress && <p className="dim">{analysisProgress}</p>}

      {payloadAnalysis && (
        <section className="analysis">
          <h2>Payload three-year mission</h2>
          {payloadAnalysis.explanations.map((line, i) => (
            <p key={i} className="analysis-line">{line}</p>
          ))}
          {payloadAnalysis.result && (
          <div className="evidence">
            <span>Baseline: {payloadAnalysis.result.passed ? "PASS" : "FAIL"}</span>
            <span>Required Δv {payloadAnalysis.result.required_delta_v.toFixed(1)} m/s</span>
            <span>Available Δv {payloadAnalysis.result.available_delta_v.toFixed(1)} m/s</span>
            <span>Remaining propellant {payloadAnalysis.result.propellant_remaining.toFixed(1)} kg</span>
          </div>
          )}
          {monteCarlo && (
            <div className="monte-carlo">
              <h3>Monte Carlo ({monteCarlo.total_runs.toLocaleString()} runs)</h3>
              <p>Pass rate {(monteCarlo.probability_pass * 100).toFixed(1)}%</p>
              {Object.keys(monteCarlo.failure_modes).length > 0 && (
                <ul>
                  {Object.entries(monteCarlo.failure_modes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <li key={reason}>{reason}: {((count / monteCarlo.total_runs) * 100).toFixed(1)}%</li>
                    ))}
                </ul>
              )}
              <p className="dim small">Failure modes overlap; percentages are not exclusive slices.</p>
            </div>
          )}
        </section>
      )}

      {robustness && (
        <section className="analysis">
          <h2>Ascent robustness ({robustness.completedRuns} runs)</h2>
          <p>
            Reaches orbit {(robustness.orbitProbability * 100).toFixed(0)}% of the time
            (95% CI {(robustness.orbitProbability95[0] * 100).toFixed(0)}–{(robustness.orbitProbability95[1] * 100).toFixed(0)}%)
          </p>
          <p>Max-Q p95 {(robustness.maxQPaP95 / 1000).toFixed(1)} kPa; peak-g p95 {robustness.maxGP95.toFixed(2)} g</p>
          <ul>
            {Object.entries(robustness.outcomeCounts).map(([outcome, count]) => (
              <li key={outcome}>{outcomeTitle(outcome as FlightOutcome)}: {count}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
