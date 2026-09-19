/**
 * Debrief screen: outcome and primary cause first, evidence, synchronized
 * plots, replay/rebuild actions, and optional payload mission + robustness
 * analysis.
 */

import { useMemo, useState } from "react";

import { analyzePayload, createPayloadHandoff, type PayloadAnalysis } from "../../sim/orbital/payload";
import { MOON_RADIUS_M } from "../../sim/lunar/moon";
import type { MonteCarloSummary } from "../../sim/orbital/types";
import type { AscentRobustnessResult, AscentSensitivityResult } from "../../sim/ascent/robustness";
import { useAppStore, simClient } from "../store";
import { TelemetryChart, type ChartChannel } from "../components/TelemetryChart";
import {
  buildRunReport,
  compareRunToCurrent,
  copyConfigToClipboard,
  downloadText,
} from "../../persistence/report";
function outcomeTitle(outcome: string): string {
  return outcome.replaceAll("_", " ").toUpperCase();
}

export function DebriefScreen() {
  const { flight, setScreen, returnToBuild, startExperiment, runSummaries, persistenceNotice } = useAppStore();
  const [hoverTimeS, setHoverTimeS] = useState<number | null>(null);
  const [payloadAnalysis, setPayloadAnalysis] = useState<PayloadAnalysis | null>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloSummary | null>(null);
  const [robustness, setRobustness] = useState<AscentRobustnessResult | null>(null);
  const [sensitivity, setSensitivity] = useState<AscentSensitivityResult | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const handoff = useMemo(
    () =>
      flight
        ? createPayloadHandoff({
            orbitAchieved: flight.orbitAchieved,
            // The parking orbit, not `finalElements`: every orbit-achieving
            // flight now continues through TLI (LUNAR_MISSION_PLAN.md
            // §2.1), so `finalElements` describes the trans-lunar
            // trajectory, not something a LEO payload mission model can use.
            finalElements: flight.parkingElements ?? flight.finalElements,
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

  const assessment = flight.assessment;
  const diagnosis = assessment.primaryDiagnosis;
  const currentSummary = runSummaries.find((run) => run.seed === flight.seed);
  const baseline = currentSummary?.baselineRunId ? runSummaries.find((run) => run.id === currentSummary.baselineRunId) : null;
  const failureEvent = flight.events.find((e) => e.id === "failed");
  // The parking orbit, not `finalElements`: any flight that attempted TLI
  // has `finalElements` describing the trans-lunar trajectory instead
  // (LUNAR_MISSION_PLAN.md §2.1). Fall back to `finalElements` only for
  // flights that never got that far (e.g. `low_perigee`).
  const el = flight.parkingElements ?? flight.finalElements;
  const lunar = flight.lunarTransfer;

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

  const serializedInput = {
    config: flight.config,
    weather: flight.weather,
    launchLatitudeDeg: 0,
    launchLongitudeDeg: 0,
    localWindEastMs: 0,
    localWindNorthMs: 0,
    seed: flight.seed,
  };

  const runRobustness = async () => {
    setAnalysisProgress("Ascent robustness…");
    setRobustness(null);
    const { promise } = simClient.runAscentAnalysis(
      { input: serializedInput, runs: 200, seed: flight.seed },
      (completed, total) => setAnalysisProgress(`Robustness ${Math.round((completed / total) * 100)}%`),
    );
    try {
      setRobustness(await promise);
    } catch {
      // canceled
    }
    setAnalysisProgress(null);
  };

  const runSensitivity = async () => {
    setAnalysisProgress("Parameter sensitivity…");
    setSensitivity(null);
    const { promise } = simClient.runAscentSensitivity(
      { input: serializedInput, runsPerParameter: 100, seed: flight.seed },
      (completed, total) => setAnalysisProgress(`Sensitivity ${Math.round((completed / total) * 100)}%`),
    );
    try {
      setSensitivity(await promise);
    } catch {
      // canceled
    }
    setAnalysisProgress(null);
  };

  return (
    <div className="screen debrief">
      <header className={`outcome ${flight.orbitAchieved ? "success" : "failure"}`}>
        <h1>{diagnosis?.title ?? outcomeTitle(flight.outcome)}</h1>
        {el && (
          <p className="orbit-line">
            Orbit: {el.perigeeAltitudeKm.toFixed(0)} × {el.apogeeAltitudeKm?.toFixed(0) ?? "?"} km, inclination {el.inclinationDeg.toFixed(1)}°
          </p>
        )}
      </header>

      <section className="cause-card">
        <h2>{diagnosis ? "Primary diagnosis" : "Flight result"}</h2>
        <p className="cause-detail">{diagnosis?.explanation ?? flight.failureDetail ?? "The flight met its objective."}</p>
        {failureEvent && <p className="cause-time">at {failureEvent.t.toFixed(1)} s</p>}
        {diagnosis && <p className="cause-suggestion">{diagnosis.evidence} Try one change: {diagnosis.recommendedExperiment.label}.</p>}
        <div className="evidence">
          <span>Max-Q {(flight.maxQPa / 1000).toFixed(1)} kPa (limit 45)</span>
          <span>Peak g {flight.maxG.toFixed(2)} (limit 5.0)</span>
          {el && <span>Perigee {el.perigeeAltitudeKm.toFixed(0)} km (sustained ≥ 150)</span>}
        </div>
      </section>

      {lunar && (
        <section className="analysis">
          <h2>Trans-lunar injection — {outcomeTitle(lunar.classification)}</h2>
          <div className="evidence">
            <span>
              Δv spent {lunar.deltaVAvailableMs.toFixed(0)} m/s of {lunar.deltaVRequiredMs.toFixed(0)} m/s required
            </span>
            <span>Achieved apogee {(lunar.achievedApogeeM / 1000).toFixed(0)} km</span>
            {lunar.timeOfFlightS !== null && (
              <span>Time of flight {(lunar.timeOfFlightS / 86_400).toFixed(1)} days</span>
            )}
            {lunar.periseleneRadiusM !== null && (
              <span>Periselene altitude {((lunar.periseleneRadiusM - 1_737_400) / 1000).toFixed(0)} km</span>
            )}
          </div>
          <p className="dim small">
            {lunar.classification === "lunar_arrival" &&
              "The transfer reached the Moon's sphere of influence within the aim corridor."}
            {lunar.classification === "lunar_impact" &&
              "The transfer reached the Moon's sphere of influence, but periselene fell below the surface."}
            {lunar.classification === "lunar_miss" &&
              "The transfer either missed the Moon's sphere of influence or landed outside the aim corridor."}
            {lunar.classification === "tli_shortfall" &&
              "The upper stage ran out of usable delta-v before the transfer could reach the Moon's distance."}
            {lunar.classification === "earth_escape" &&
              "The burn carried far more energy than the transfer needed."}
            {" "}The Earth-Moon coast is evaluated analytically (patched conic), not simulated step by step, and the Moon's own gravity during the Earth leg is not modelled — see LUNAR_MISSION_PLAN.md §3.
          </p>
        </section>
      )}

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
        {currentSummary && diagnosis && (
          <button onClick={() => startExperiment(currentSummary, diagnosis.recommendedExperiment)}>
            Try one change: {diagnosis.recommendedExperiment.label}
          </button>
        )}
        {handoff && (
          <button onClick={runPayloadMission} disabled={analysisProgress !== null}>
            Analyze payload mission
          </button>
        )}
        <button onClick={runRobustness} disabled={analysisProgress !== null}>
          Run robustness analysis
        </button>
        <button onClick={runSensitivity} disabled={analysisProgress !== null}>
          Parameter sensitivity
        </button>
        <button onClick={() => downloadText(`apogee-run-${flight.seed}.json`, buildRunReport(flight))}>
          Download report (JSON)
        </button>
        <button
          onClick={async () => {
            setCopied(await copyConfigToClipboard(flight.config));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied!" : "Copy build config"}
        </button>
      </div>
      {analysisProgress && <p className="dim">{analysisProgress}</p>}
      {persistenceNotice && <p className="check warning">⚠ {persistenceNotice}</p>}

      {baseline && (() => {
        const comparison = compareRunToCurrent(flight, baseline);
        const label = comparison.kind === "one_relevant_change"
          ? "Controlled experiment"
          : comparison.kind === "no_change"
            ? "No build change"
            : comparison.kind === "incompatible_baseline"
              ? "Baseline needs re-evaluation"
              : "Multiple changes — correlation only";
        return (
          <section className="analysis">
            <h2>{label}</h2>
            <p className="analysis-line">Outcome: {comparison.outcomeChange}</p>
            <p className="dim small">{comparison.kind === "one_relevant_change" ? "This run changed the suggested control only, so the comparison can support a causal explanation." : "This comparison reports measurements without claiming that one change caused the difference."}</p>
            <ul>{comparison.configDiffs.map((diff) => <li key={diff}>{diff}</li>)}</ul>
          </section>
        );
      })()}

      {runSummaries.length > 1 && (
        <section className="analysis">
          <h2>Compare with a saved run</h2>
          <select value={compareRunId} onChange={(e) => setCompareRunId(e.target.value)} aria-label="Compare run">
            <option value="">Select a previous run…</option>
            {runSummaries
              .filter((r) => r.config !== flight.config || r.outcome !== flight.outcome)
              .slice(0, 10)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.timestamp).toLocaleTimeString()} — {r.outcome}
                </option>
              ))}
          </select>
          {compareRunId &&
            (() => {
              const previous = runSummaries.find((r) => r.id === compareRunId);
              if (!previous) {
                return null;
              }
              const { configDiffs, outcomeChange } = compareRunToCurrent(flight, previous);
              return (
                <div>
                  <p className="analysis-line">Outcome: {outcomeChange}</p>
                  {configDiffs.length > 0 ? (
                    <ul>
                      {configDiffs.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="analysis-line">Identical build configuration.</p>
                  )}
                </div>
              );
            })()}
        </section>
      )}

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
              {monteCarlo.sensitivity_results.length > 0 && (
                <>
                  <h3>Most sensitive parameters</h3>
                  <ul>
                    {monteCarlo.sensitivity_results.slice(0, 5).map((s) => (
                      <li key={s.parameter}>
                        {s.parameter}: {(s.failure_rate * 100).toFixed(1)}% failure rate, mean |Δv| change {s.mean_abs_delta_v_change.toFixed(2)} m/s
                      </li>
                    ))}
                  </ul>
                </>
              )}
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
              <li key={outcome}>{outcomeTitle(outcome)}: {count}</li>
            ))}
          </ul>
          {Object.keys(robustness.primaryDiagnosisCounts).length > 0 && (
            <>
              <h3>Primary diagnoses</h3>
              <ul>{Object.entries(robustness.primaryDiagnosisCounts).map(([id, count]) => <li key={id}>{id.replaceAll("_", " ")}: {count}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {sensitivity && (
        <section className="analysis">
          <h2>Ascent parameter sensitivity (100 runs each)</h2>
          <p className="dim small">
            Nominal orbit rate {(sensitivity.nominal.orbitProbability * 100).toFixed(0)}%. Change when each
            parameter is perturbed alone:
          </p>
          <ul>
            {sensitivity.entries.map((e) => (
              <li key={e.parameter}>
                {e.parameter}: {(e.probabilityChange * 100).toFixed(0)} pp
                ({(e.orbitProbability * 100).toFixed(0)}% reaches orbit)
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
