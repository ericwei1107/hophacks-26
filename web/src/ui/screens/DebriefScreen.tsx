/**
 * Debrief screen: outcome and primary cause first, evidence, synchronized
 * plots, replay/rebuild actions, and optional payload mission + robustness
 * analysis.
 */

import { useMemo, useState } from "react";

import { analyzePayload, createPayloadHandoff, type PayloadAnalysis } from "../../sim/orbital/payload";
import {
  analyzeLaunchedPayload,
  usePythonBackendStatus,
  type PythonPayloadReport,
} from "../../api/pythonBackend";
import { MOON_RADIUS_M } from "../../sim/lunar/moon";
import { GAME_MISSION_RULES } from "../../sim/orbital/types";
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
import { fetchCensus, type SatcatCensus } from "../../sim/orbital/debris";

function outcomeTitle(outcome: string): string {
  return outcome.replaceAll("_", " ").toUpperCase();
}

function prettyLabel(value: string): string {
  if (value === "f107") {
    return "F10.7";
  }
  if (value === "debris_environment") {
    return "Crowding (SATCAT)";
  }
  const text = value
    .replace(/_error_deg$/, " error")
    .replace(/_error_km$/, " error")
    .replace(/delta_v/g, "Δv")
    .replace(/_deg$/, "")
    .replace(/_km$/, "")
    .replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pass" | "fail" | "neutral";
}) {
  return (
    <div className={`stat-tile${tone ? ` ${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function CrowdingTable({ census }: { census: SatcatCensus }) {
  const counts = census.counts;
  return (
    <div className="report-block">
      <h3>Crowding obstacle (SATCAT)</h3>
      <p className="report-note">
        Objects in ±30 km of the parking altitude. cam_scale is vs a quieter 400 km
        shell and multiplies avoidance fuel. Not collision probability.
      </p>
      <table className="census-table">
        <tbody>
          <tr>
            <th>Shell</th>
            <td>
              {census.shell_low.toFixed(0)}–{census.shell_high.toFixed(0)} km
            </td>
          </tr>
          <tr>
            <th>Total objects</th>
            <td>{counts.total}</td>
          </tr>
          <tr>
            <th>Payloads</th>
            <td>{counts.payload}</td>
          </tr>
          <tr>
            <th>Rocket bodies</th>
            <td>{counts.rocket_body}</td>
          </tr>
          <tr>
            <th>Debris</th>
            <td>{counts.debris}</td>
          </tr>
          <tr>
            <th>cam_scale</th>
            <td>{census.cam_scale}</td>
          </tr>
          <tr>
            <th>Obstacle</th>
            <td>{census.obstacle}</td>
          </tr>
        </tbody>
      </table>
      <p className="report-footnote">
        {census.source}. {census.note}
      </p>
    </div>
  );
}

export function DebriefScreen() {
  const { flight, setScreen, returnToBuild, startExperiment, runSummaries, persistenceNotice } = useAppStore();
  const [hoverTimeS, setHoverTimeS] = useState<number | null>(null);
  const [payloadAnalysis, setPayloadAnalysis] = useState<PayloadAnalysis | null>(null);
  const [pythonReport, setPythonReport] = useState<PythonPayloadReport | null>(null);
  const [pythonError, setPythonError] = useState<string | null>(null);
  const [debrisCensus, setDebrisCensus] = useState<SatcatCensus | null>(null);
  const pythonStatus = usePythonBackendStatus();
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
    setMonteCarlo(null);
    setPythonReport(null);
    setPythonError(null);
    setDebrisCensus(null);

    setAnalysisProgress("Python payload analysis…");
    try {
      const report = await analyzeLaunchedPayload(handoff, {
        runs: 1_000,
        sensitivityRuns: 200,
        includeBriefing: true,
      });
      setPythonReport(report);
      if (report.debris) {
        setDebrisCensus(report.debris);
      }
      setPayloadAnalysis({
        handoff,
        rules: GAME_MISSION_RULES,
        dryMassKg: report.dryMassKg,
        onboardPropellantKg: report.onboardPropellantKg,
        crossSectionAreaM2: report.crossSectionAreaM2,
        ispS: report.ispS,
        missionYears: report.missionYears,
        circularizationDeltaVMs: report.circularizationDeltaVMs,
        circularizationPropellantKg: report.circularizationPropellantKg,
        insertionBudgetOk: report.insertionBudgetOk,
        mission: report.mission,
        result: report.result,
        explanations: report.explanations,
      });
      if (report.monteCarlo) {
        setMonteCarlo(report.monteCarlo);
      }
      setAnalysisProgress(null);
      return;
    } catch (error) {
      setPythonError(error instanceof Error ? error.message : String(error));
    }

    const census = await fetchCensus(handoff.achievedApogeeKm, false, handoff.seed);
    setDebrisCensus(census);
    const scaled = analyzePayload(handoff, GAME_MISSION_RULES, census.cam_scale);
    setPayloadAnalysis(scaled);

    if (!scaled.mission) {
      setAnalysisProgress(null);
      return;
    }

    setAnalysisProgress("Monte Carlo (local TypeScript)…");
    const { promise } = simClient.runOrbitalMonteCarlo(
      {
        mission: scaled.mission,
        weather: handoff.weather,
        runs: 10_000,
        sensitivityRuns: 1_000,
        seed: handoff.seed,
        rules: "game",
        camScaleMean: census.cam_scale,
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
        <p className="dim small">
          {pythonStatus === "up"
            ? "Python backend is live — payload analysis uses the original operations model."
            : pythonStatus === "down"
              ? "Python backend is off — payload analysis will use the local TypeScript port."
              : "Checking Python backend…"}
        </p>
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
              <span>Periselene altitude {((lunar.periseleneRadiusM - MOON_RADIUS_M) / 1000).toFixed(0)} km</span>
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

      {payloadAnalysis && (() => {
        const extraInsights = (pythonReport?.insights ?? []).filter((line) => {
          if (payloadAnalysis.explanations.includes(line)) {
            return false;
          }
          if (/^(Baseline mission|Monte Carlo pass rate|Most common failure|Most sensitive parameter|Launch analog|Payload share|Attributed launch)/.test(line)) {
            return false;
          }
          return true;
        });
        const census = pythonReport?.debris ?? debrisCensus;
        return (
        <section className="analysis report">
          <div className="report-head">
            <div>
              <p className="report-kicker">Payload operations</p>
              <h2>Three-year mission</h2>
            </div>
            <span className={`report-badge${pythonReport ? " live" : pythonError ? " local" : ""}`}>
              {pythonReport ? "Python" : pythonError ? "TypeScript fallback" : "Local"}
            </span>
          </div>
          {pythonError && <p className="check warning">⚠ {pythonError}</p>}
          {payloadAnalysis.explanations[0] && (
            <p className="report-lead">{payloadAnalysis.explanations[0].replace("m^2", "m²")}</p>
          )}
          {payloadAnalysis.result && (
            <div className="stat-grid">
              <StatTile
                label="Baseline"
                value={payloadAnalysis.result.passed ? "PASS" : "FAIL"}
                tone={payloadAnalysis.result.passed ? "pass" : "fail"}
              />
              <StatTile label="Required Δv" value={`${payloadAnalysis.result.required_delta_v.toFixed(0)} m/s`} />
              <StatTile label="Available Δv" value={`${payloadAnalysis.result.available_delta_v.toFixed(0)} m/s`} />
              <StatTile label="Propellant left" value={`${payloadAnalysis.result.propellant_remaining.toFixed(0)} kg`} />
            </div>
          )}
          {payloadAnalysis.explanations.slice(1).filter((line) => !line.startsWith("Baseline mission")).map((line) => (
            <p key={line} className="report-note">{line.replace("m^2", "m²")}</p>
          ))}
          {monteCarlo && (
            <div className="report-block">
              <div className="pass-hero">
                <p className={`pass-hero-value${monteCarlo.probability_pass >= 0.5 ? " pass" : monteCarlo.probability_pass >= 0.2 ? " warn" : " fail"}`}>
                  {(monteCarlo.probability_pass * 100).toFixed(1)}%
                </p>
                <p className="pass-hero-label">
                  pass rate across {monteCarlo.total_runs.toLocaleString()} Monte Carlo runs
                  {pythonReport ? " · Python" : pythonError ? " · TypeScript" : ""}
                </p>
              </div>
              {Object.keys(monteCarlo.failure_modes).length > 0 && (
                <div className="mode-list">
                  {Object.entries(monteCarlo.failure_modes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => {
                      const pct = (count / monteCarlo.total_runs) * 100;
                      return (
                        <div key={reason} className="mode-row">
                          <span className="mode-name">{prettyLabel(reason)}</span>
                          <div className="mode-track" aria-hidden="true">
                            <div className="mode-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="mode-pct">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                </div>
              )}
              <p className="report-footnote">Failure modes overlap, so the percentages are not exclusive slices.</p>
              {monteCarlo.sensitivity_results.length > 0 && (
                <>
                  <h3>Most sensitive parameters</h3>
                  <div className="mode-list">
                    {monteCarlo.sensitivity_results.slice(0, 5).map((s) => (
                      <div key={s.parameter} className="mode-row">
                        <span className="mode-name">{prettyLabel(s.parameter)}</span>
                        <div className="mode-track" aria-hidden="true">
                          <div className="mode-fill muted" style={{ width: `${Math.min(100, s.failure_rate * 100)}%` }} />
                        </div>
                        <span className="mode-pct">
                          {(s.failure_rate * 100).toFixed(1)}% fail · {s.mean_abs_delta_v_change.toFixed(0)} m/s
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {census && <CrowdingTable census={census} />}
          {extraInsights.length > 0 && (
            <div className="report-block">
              <h3>What this means</h3>
              <ul className="insight-list">
                {extraInsights.map((line) => (
                  <li key={line}>{line.replace(/^\s+-\s+/, "")}</li>
                ))}
              </ul>
            </div>
          )}
          {pythonReport?.emissions && (
            <div className="report-block analog-card">
              <h3>Launch analog</h3>
              <p className="analog-title">{pythonReport.emissions.analog}</p>
              <div className="stat-grid compact">
                <StatTile
                  label="Insertion orbit"
                  value={`${pythonReport.emissions.orbitKm[0].toFixed(0)} × ${pythonReport.emissions.orbitKm[1].toFixed(0)} km`}
                />
                <StatTile label="Payload share" value={`${(pythonReport.emissions.payloadShare * 100).toFixed(0)}%`} />
                <StatTile label="Attributed CO2e" value={`${pythonReport.emissions.co2eTonnes.toFixed(1)} t`} />
              </div>
              <p className="report-footnote">{pythonReport.emissions.citation}</p>
            </div>
          )}
          {pythonReport?.regulatory && (
            <div className="report-block">
              <h3>Five-year disposal rule</h3>
              <p className={`status-pill${pythonReport.regulatory.compliant ? " pass" : " fail"}`}>
                {pythonReport.regulatory.compliant ? "Compliant" : "Not compliant"}
              </p>
              <p className="report-note">
                {pythonReport.regulatory.compliant
                  ? "Post-mission decay is within the five-year de-orbit screening check (mission life is not used as decay time)."
                  : pythonReport.regulatory.violations.join(" ")}
              </p>
              <p className="report-footnote">Federal Register records are context, not legal advice.</p>
            </div>
          )}
          {pythonReport?.briefingError && (
            <p className="check warning">⚠ Pitch closer: {pythonReport.briefingError}</p>
          )}
          {pythonReport?.briefing && (
            <div className="report-block">
              <h3>Pitch closer</h3>
              <p className="report-lead">{pythonReport.briefing}</p>
            </div>
          )}
        </section>
        );
      })()}

      {robustness && (
        <section className="analysis report">
          <div className="report-head">
            <div>
              <p className="report-kicker">Ascent</p>
              <h2>Robustness</h2>
            </div>
          </div>
          <div className="stat-grid">
            <StatTile
              label="Reaches orbit"
              value={`${(robustness.orbitProbability * 100).toFixed(0)}%`}
              tone={robustness.orbitProbability >= 0.5 ? "pass" : "fail"}
            />
            <StatTile
              label="95% CI"
              value={`${(robustness.orbitProbability95[0] * 100).toFixed(0)}–${(robustness.orbitProbability95[1] * 100).toFixed(0)}%`}
            />
            <StatTile label="Max-Q p95" value={`${(robustness.maxQPaP95 / 1000).toFixed(1)} kPa`} />
            <StatTile label="Peak-g p95" value={`${robustness.maxGP95.toFixed(2)} g`} />
          </div>
          <div className="mode-list">
            {Object.entries(robustness.outcomeCounts).map(([outcome, count]) => (
              <div key={outcome} className="mode-row plain">
                <span className="mode-name">{prettyLabel(outcome)}</span>
                <span className="mode-pct">{count} / {robustness.completedRuns}</span>
              </div>
            ))}
          </div>
          {Object.keys(robustness.primaryDiagnosisCounts).length > 0 && (
            <div className="report-block">
              <h3>Primary diagnoses</h3>
              <ul className="insight-list">
                {Object.entries(robustness.primaryDiagnosisCounts).map(([id, count]) => (
                  <li key={id}>{prettyLabel(id)} · {count}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {sensitivity && (
        <section className="analysis report">
          <div className="report-head">
            <div>
              <p className="report-kicker">Ascent</p>
              <h2>Parameter sensitivity</h2>
            </div>
          </div>
          <p className="report-note">
            Nominal orbit rate {(sensitivity.nominal.orbitProbability * 100).toFixed(0)}%. Change when each
            parameter is perturbed alone:
          </p>
          <div className="mode-list">
            {sensitivity.entries.map((e) => (
              <div key={e.parameter} className="mode-row plain">
                <span className="mode-name">{prettyLabel(e.parameter)}</span>
                <span className="mode-pct">
                  {(e.probabilityChange * 100).toFixed(0)} pp · {(e.orbitProbability * 100).toFixed(0)}% reaches orbit
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
