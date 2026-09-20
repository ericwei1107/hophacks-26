/**
 * Assembly screen: build the rocket, see live engineering readouts, launch.
 */

import { OrbitControls } from "@react-three/drei";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { SafeCanvas } from "../components/SafeCanvas";
import { CONFIG_RANGES } from "../../domain/config";
import type { BuildCheck } from "../../domain/derive";
import type { EngineId } from "../../domain/engines";
import { useAppStore } from "../store";
import { RocketMesh } from "../components/RocketMesh";
import { SettingsToggle } from "../components/SettingsToggle";
import { SpaceWeatherPanel } from "../components/SpaceWeatherPanel";
import { usePythonBackendStatus } from "../../api/pythonBackend";
import { NarratedText } from "../../narration/NarratedText";

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  format,
  hint,
  suggested = false,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  suggested?: boolean;
  onCommit?: () => void;
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
        onPointerUp={onCommit}
        onBlur={onCommit}
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
        onBlur={onCommit}
        aria-label={`${label} value`}
      />
      <span className="control-value">{display}</span>
      {hint && <span className="control-hint">{hint}</span>}
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
  const {
    config,
    derived,
    updateConfig,
    persistBuild,
    resetToReference,
    launch,
    flightLoading,
    flightError,
    analysisStale,
    experimentBaseline,
    suggestedExperiment,
    persistenceNotice,
    weather,
  } = useAppStore(
    useShallow((s) => ({
      config: s.config,
      derived: s.derived,
      updateConfig: s.updateConfig,
      persistBuild: s.persistBuild,
      resetToReference: s.resetToReference,
      launch: s.launch,
      flightLoading: s.flightLoading,
      flightError: s.flightError,
      analysisStale: s.analysisStale,
      experimentBaseline: s.experimentBaseline,
      suggestedExperiment: s.suggestedExperiment,
      persistenceNotice: s.persistenceNotice,
      weather: s.weather,
    })),
  );
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
          <NarratedText>Deliver as much useful mission mass as possible, with enough onboard propellant to circularize and operate. First reach a 180–220 × 180–250 km parking orbit, then complete the lunar transfer.</NarratedText>
        </section>
        {experimentBaseline && suggestedExperiment && (
          <section className="experiment-card">
            <strong>Experiment baseline pinned</strong>
            <NarratedText narration={`Try one change: ${suggestedExperiment.label}. Compare the next flight with ${experimentBaseline.outcome.replaceAll("_", " ")}.`}>Try one change: {suggestedExperiment.label}. Compare the next flight with {experimentBaseline.outcome.replaceAll("_", " ")}.</NarratedText>
          </section>
        )}

        <section className="controls">
          <Slider label="Mission payload (dry)" value={config.payloadDryMassKg} min={CONFIG_RANGES.payloadDryMassKg.min} max={CONFIG_RANGES.payloadDryMassKg.max} step={CONFIG_RANGES.payloadDryMassKg.step} unit="kg" onChange={(v) => updateConfig({ payloadDryMassKg: v })} onCommit={persistBuild} format={(v) => `${(v / 1000).toFixed(1)} t`} hint="More delivered capability, but every kilogram must be accelerated to orbit." suggested={suggestedExperiment?.control === "payloadDryMassKg"} />
          <Slider label="Payload propellant" value={config.payloadPropellantKg} min={CONFIG_RANGES.payloadPropellantKg.min} max={CONFIG_RANGES.payloadPropellantKg.max} step={CONFIG_RANGES.payloadPropellantKg.step} unit="kg" onChange={(v) => updateConfig({ payloadPropellantKg: v })} onCommit={persistBuild} format={(v) => `${(v / 1000).toFixed(1)} t`} hint="Funds circularization and operations after launch, at the cost of ascent mass." suggested={suggestedExperiment?.control === "payloadPropellantKg"} />
          <Slider label="Body diameter" value={config.diameterM} min={CONFIG_RANGES.diameterM.min} max={CONFIG_RANGES.diameterM.max} step={CONFIG_RANGES.diameterM.step} unit="m" onChange={(v) => updateConfig({ diameterM: v })} onCommit={persistBuild} format={(v) => `${v.toFixed(1)} m`} hint="Fits engines and shortens tanks, but adds frontal drag and fairing mass." suggested={suggestedExperiment?.control === "diameterM"} />
          <Slider label="Stage 1 propellant" value={config.stage1PropellantKg} min={CONFIG_RANGES.stage1PropellantKg.min} max={CONFIG_RANGES.stage1PropellantKg.max} step={CONFIG_RANGES.stage1PropellantKg.step} unit="kg" onChange={(v) => updateConfig({ stage1PropellantKg: v })} onCommit={persistBuild} format={(v) => `${(v / 1000).toFixed(0)} t`} />
          <Slider label="Stage 1 engines" value={config.stage1EngineCount} min={CONFIG_RANGES.stage1EngineCount.min} max={CONFIG_RANGES.stage1EngineCount.max} step={1} unit="" onChange={(v) => updateConfig({ stage1EngineCount: Math.round(v) })} onCommit={persistBuild} format={(v) => `${v}×`} hint="Adds thrust, dry mass and fuel flow; excess thrust raises max-Q and g-load." suggested={suggestedExperiment?.control === "stage1EngineCount"} />
          <EngineSelect label="Stage 1 engine" value={config.stage1Engine} options={[{ id: "booster", name: "B-1 Booster" }, { id: "sustainer", name: "S-2 Sustainer" }]} onChange={(id) => { updateConfig({ stage1Engine: id }); persistBuild(); }} />
          <Slider label="Stage 2 propellant" value={config.stage2PropellantKg} min={CONFIG_RANGES.stage2PropellantKg.min} max={CONFIG_RANGES.stage2PropellantKg.max} step={CONFIG_RANGES.stage2PropellantKg.step} unit="kg" onChange={(v) => updateConfig({ stage2PropellantKg: v })} onCommit={persistBuild} format={(v) => `${(v / 1000).toFixed(0)} t`} suggested={suggestedExperiment?.control === "stage2PropellantKg"} />
          <EngineSelect label="Stage 2 engine" value={config.stage2Engine} options={[{ id: "cryogenic", name: "H-1 Cryogenic — efficient, heavy" }, { id: "vacuum", name: "V-9 Vacuum — lighter, less efficient" }, { id: "sustainer", name: "S-2 Sustainer — compact, low vacuum performance" }]} onChange={(id) => { updateConfig({ stage2Engine: id }); persistBuild(); }} />
          <Slider label="Fin span" value={config.finSpanM} min={CONFIG_RANGES.finSpanM.min} max={CONFIG_RANGES.finSpanM.max} step={CONFIG_RANGES.finSpanM.step} unit="m" onChange={(v) => updateConfig({ finSpanM: v })} onCommit={persistBuild} format={(v) => `${v.toFixed(1)} m`} hint="Improves static stability, while adding structural mass and aerodynamic drag." suggested={suggestedExperiment?.control === "finSpanM"} />
        </section>

        <section className="readouts">
          <Readout label="Liftoff TWR" value={derived.liftoffTwr.toFixed(2)} warn={derived.liftoffTwr <= 1} />
          <Readout label="Ideal Δv" value={`${(derived.totalIdealDeltaVMs / 1000).toFixed(1)} km/s`} />
          <Readout label="Drag area CdA" value={`${derived.dragAreaM2.toFixed(2)} m²`} />
          <Readout label="Stability margin" value={`${derived.staticMargin.toFixed(2)} cal`} warn={derived.staticMargin < 1} />
          <Readout label="Slenderness" value={derived.slenderness.toFixed(1)} warn={derived.slenderness > 15} />
          <Readout label="Wet mass" value={`${(derived.wetMassKg / 1000).toFixed(0)} t`} />
          <Readout label="Useful payload" value={`${(config.payloadDryMassKg / 1000).toFixed(1)} t`} />
        </section>

        {errors.length > 0 && (
          <section className="checks errors">
            {errors.map((c) => (
              <NarratedText key={c.id} className="check error" narration={c.message}>✕ {c.message}</NarratedText>
            ))}
          </section>
        )}
        {warnings.length > 0 && (
          <section className="checks warnings">
            {warnings.map((c) => (
              <NarratedText key={c.id} className="check warning" narration={c.message}>⚠ {c.message}</NarratedText>
            ))}
          </section>
        )}
        {flightError && <NarratedText className="check error" narration={flightError}>✕ {flightError}</NarratedText>}

        <div className="actions">
          <button className="launch" onClick={launch} disabled={!canLaunch}>
            {flightLoading ? "Computing…" : "LAUNCH"}
          </button>
          <button onClick={resetToReference}>Reset to reference build</button>
        </div>
        {analysisStale && <p className="dim small">Build edited — prior analysis invalidated until rerun.</p>}
        <SpaceWeatherPanel snapshot={weather} />
        <p className="dim small">
          {pythonStatus === "up"
            ? "Payload analysis: Python"
            : pythonStatus === "down"
              ? "Payload analysis: local TypeScript"
              : "Checking Python backend…"}
        </p>
        {persistenceNotice && <p className="check warning">⚠ {persistenceNotice}</p>}
        <SettingsToggle />
      </div>
    </div>
  );
}
