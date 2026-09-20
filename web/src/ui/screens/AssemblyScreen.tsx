/**
 * Assembly screen: build the rocket, see live engineering readouts, launch.
 */

import { OrbitControls } from "@react-three/drei";
import { useEffect } from "react";

import { SafeCanvas } from "../components/SafeCanvas";
import { CONFIG_RANGES } from "../../domain/config";
import type { BuildCheck } from "../../domain/derive";
import type { EngineId } from "../../domain/engines";
import { useAppStore } from "../store";
import { RocketMesh } from "../components/RocketMesh";
import { SettingsToggle } from "../components/SettingsToggle";
import { usePythonBackendStatus } from "../../api/pythonBackend";

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  format,
  suggested = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  suggested?: boolean;
}) {
  const display = format ? format(value) : `${value} ${unit}`;
  return (
    <label className={`control${suggested ? " suggested-control" : ""}`}>
      <span className="control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <input
        type="number"
        className="control-number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            onChange(Math.min(max, Math.max(min, v)));
          }
        }}
        aria-label={`${label} value`}
      />
      <span className="control-value">{display}</span>
    </label>
  );
}

function EngineSelect({
  label,
  value,
  options,
  onChange,
  suggested = false,
}: {
  label: string;
  value: EngineId;
  options: { id: EngineId; name: string }[];
  onChange: (id: EngineId) => void;
  suggested?: boolean;
}) {
  return (
    <label className={`control${suggested ? " suggested-control" : ""}`}>
      <span className="control-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as EngineId)} aria-label={label}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Readout({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`readout${warn ? " warn" : ""}`}>
      <span className="readout-label">{label}</span>
      <span className="readout-value">{value}</span>
    </div>
  );
}

export function AssemblyScreen() {
  const { config, derived, updateConfig, resetToReference, launch, flightLoading, flightError, analysisStale, experimentBaseline, suggestedExperiment, persistenceNotice, weather } =
    useAppStore();
  const pythonStatus = usePythonBackendStatus();

  const errors = derived.checks.filter((c: BuildCheck) => c.severity === "error");
  const warnings = derived.checks.filter((c: BuildCheck) => c.severity === "warning");
  const canLaunch = errors.length === 0 && !flightLoading;

  useEffect(() => {
    if (!suggestedExperiment) {
      return;
    }
    const input = document.querySelector<HTMLElement>(".suggested-control input, .suggested-control select");
    input?.focus();
  }, [suggestedExperiment]);

  return (
    <div className="screen assembly">
      <div className="viewport">
        <SafeCanvas camera={{ position: [derived.totalLengthM * 1.2, derived.totalLengthM * 0.45, derived.totalLengthM * 1.2], fov: 45 }}>
          <color attach="background" args={["#07111f"]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 20, 10]} intensity={1.2} />
          <RocketMesh rocket={derived} showMarkers />
          <OrbitControls enablePan={false} />
        </SafeCanvas>
        <div className="viewport-caption">CM <span className="cyan">●</span> / CP <span className="orange">●</span></div>

        {/* Side-profile inset showing the complete stack. */}
        <div className="side-inset">
          <SafeCanvas orthographic camera={{ position: [derived.totalLengthM * 1.4, derived.totalLengthM / 2, 0], zoom: 18 }}>
            <color attach="background" args={["#0a1626"]} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 10, 5]} intensity={1} />
            <RocketMesh rocket={derived} />
          </SafeCanvas>
          <div className="inset-caption">SIDE PROFILE</div>
        </div>
      </div>

      <div className="panel">
        <h1>APOGEE <span className="dim">/ Launch Lab</span></h1>

        <section className="objective-card">
          <strong>Launch objective</strong>
          <p>Place the payload in a 180–220 × 180–250 km orbit. Perigee must stay above 150 km; structural max-Q is 45 kPa and payload load is 5 g.</p>
        </section>
        {experimentBaseline && suggestedExperiment && (
          <section className="experiment-card">
            <strong>Experiment baseline pinned</strong>
            <p>Try one change: {suggestedExperiment.label}. Compare the next flight with {experimentBaseline.outcome.replaceAll("_", " ")}.</p>
          </section>
        )}

        <section className="controls">
          <Slider label="Payload wet mass" value={config.payloadWetMassKg} min={CONFIG_RANGES.payloadWetMassKg.min} max={CONFIG_RANGES.payloadWetMassKg.max} step={CONFIG_RANGES.payloadWetMassKg.step} unit="kg" onChange={(v) => updateConfig({ payloadWetMassKg: v })} format={(v) => `${(v / 1000).toFixed(1)} t`} suggested={suggestedExperiment?.control === "payloadWetMassKg"} />
          <Slider label="Body diameter" value={config.diameterM} min={CONFIG_RANGES.diameterM.min} max={CONFIG_RANGES.diameterM.max} step={CONFIG_RANGES.diameterM.step} unit="m" onChange={(v) => updateConfig({ diameterM: v })} format={(v) => `${v.toFixed(1)} m`} suggested={suggestedExperiment?.control === "diameterM"} />
          <Slider label="Stage 1 propellant" value={config.stage1PropellantKg} min={CONFIG_RANGES.stage1PropellantKg.min} max={CONFIG_RANGES.stage1PropellantKg.max} step={CONFIG_RANGES.stage1PropellantKg.step} unit="kg" onChange={(v) => updateConfig({ stage1PropellantKg: v })} format={(v) => `${(v / 1000).toFixed(0)} t`} />
          <Slider label="Stage 1 engines" value={config.stage1EngineCount} min={CONFIG_RANGES.stage1EngineCount.min} max={CONFIG_RANGES.stage1EngineCount.max} step={1} unit="" onChange={(v) => updateConfig({ stage1EngineCount: Math.round(v) })} format={(v) => `${v}×`} suggested={suggestedExperiment?.control === "stage1EngineCount"} />
          <EngineSelect label="Stage 1 engine" value={config.stage1Engine} options={[{ id: "booster", name: "B-1 Booster" }, { id: "sustainer", name: "S-2 Sustainer" }]} onChange={(id) => updateConfig({ stage1Engine: id })} />
          <Slider label="Stage 2 propellant" value={config.stage2PropellantKg} min={CONFIG_RANGES.stage2PropellantKg.min} max={CONFIG_RANGES.stage2PropellantKg.max} step={CONFIG_RANGES.stage2PropellantKg.step} unit="kg" onChange={(v) => updateConfig({ stage2PropellantKg: v })} format={(v) => `${(v / 1000).toFixed(0)} t`} suggested={suggestedExperiment?.control === "stage2PropellantKg"} />
          <EngineSelect label="Stage 2 engine" value={config.stage2Engine} options={[{ id: "vacuum", name: "V-9 Vacuum" }, { id: "sustainer", name: "S-2 Sustainer" }]} onChange={(id) => updateConfig({ stage2Engine: id })} />
          <Slider label="Fin span" value={config.finSpanM} min={CONFIG_RANGES.finSpanM.min} max={CONFIG_RANGES.finSpanM.max} step={CONFIG_RANGES.finSpanM.step} unit="m" onChange={(v) => updateConfig({ finSpanM: v })} format={(v) => `${v.toFixed(1)} m`} suggested={suggestedExperiment?.control === "finSpanM"} />
        </section>

        <section className="readouts">
          <Readout label="Liftoff TWR" value={derived.liftoffTwr.toFixed(2)} warn={derived.liftoffTwr <= 1} />
          <Readout label="Ideal Δv" value={`${(derived.totalIdealDeltaVMs / 1000).toFixed(1)} km/s`} />
          <Readout label="Drag area CdA" value={`${derived.dragAreaM2.toFixed(2)} m²`} />
          <Readout label="Stability margin" value={`${derived.staticMargin.toFixed(2)} cal`} warn={derived.staticMargin < 1} />
          <Readout label="Slenderness" value={derived.slenderness.toFixed(1)} warn={derived.slenderness > 15} />
          <Readout label="Wet mass" value={`${(derived.wetMassKg / 1000).toFixed(0)} t`} />
        </section>

        {errors.length > 0 && (
          <section className="checks errors">
            {errors.map((c) => (
              <p key={c.id} className="check error">✕ {c.message}</p>
            ))}
          </section>
        )}
        {warnings.length > 0 && (
          <section className="checks warnings">
            {warnings.map((c) => (
              <p key={c.id} className="check warning">⚠ {c.message}</p>
            ))}
          </section>
        )}
        {flightError && <p className="check error">✕ {flightError}</p>}

        <div className="actions">
          <button className="launch" onClick={launch} disabled={!canLaunch}>
            {flightLoading ? "Computing…" : "LAUNCH"}
          </button>
          <button onClick={resetToReference}>Reset to reference build</button>
        </div>
        {analysisStale && <p className="dim small">Build edited — prior analysis invalidated until rerun.</p>}
        <p className="dim small">
          Weather: Kp {weather.weather.kp ?? "—"} · F10.7 {weather.weather.f107 ?? "—"} (
          {weather.source === "python" ? "Python NOAA" : weather.source === "noaa" ? "browser NOAA" : "reference snapshot"})
          {pythonStatus === "up"
            ? " · Payload analysis: Python"
            : pythonStatus === "down"
              ? " · Payload analysis: local TypeScript"
              : ""}
        </p>
        {persistenceNotice && <p className="check warning">⚠ {persistenceNotice}</p>}
        <SettingsToggle />
      </div>
    </div>
  );
}
