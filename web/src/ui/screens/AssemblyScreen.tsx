/**
 * Assembly screen: build the rocket, see live engineering readouts, launch.
 *
 * The left side is a studio preview of the vehicle; the right side is the
 * build panel, grouped by what the player is deciding: payload, stage 1,
 * stage 2 and aerodynamics. Every readout and check comes from the same
 * `deriveRocket` call the physics uses.
 */

import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type CSSProperties, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useShallow } from "zustand/react/shallow";

import { SafeCanvas } from "../components/SafeCanvas";
import { CONFIG_RANGES } from "../../domain/config";
import type { BuildCheck, DerivedRocket } from "../../domain/derive";
import type { EngineId } from "../../domain/engines";
import { useAppStore } from "../store";
import { RocketMesh } from "../components/RocketMesh";
import { SettingsToggle } from "../components/SettingsToggle";
import { SpaceWeatherPanel } from "../components/SpaceWeatherPanel";
import { usePythonBackendStatus } from "../../api/pythonBackend";
import { NarratedText } from "../../narration/NarratedText";
import { ROCKET_PRESETS } from "../../data/rocketPresets";

type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

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
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const trackStyle = { "--pct": `${Math.max(0, Math.min(100, pct)).toFixed(2)}%` } as CSSProperties;
  return (
    <label className={`control${suggested ? " suggested-control" : ""}`}>
      <span className="control-label">{label}</span>
      <span className="control-value">{display}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={trackStyle}
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
      {hint && <span className="control-hint">{hint}</span>}
    </label>
  );
}

function EngineSelect({
  label,
  value,
  options,
  onChange,
  hint,
  suggested = false,
}: {
  label: string;
  value: EngineId;
  options: { id: EngineId; name: string; note: string }[];
  onChange: (id: EngineId) => void;
  hint?: string;
  suggested?: boolean;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <label className={`control control-select${suggested ? " suggested-control" : ""}`}>
      <span className="control-label">{label}</span>
      <span className="control-value">{current?.note ?? ""}</span>
      <span className="select-wrap">
        <select value={value} onChange={(e) => onChange(e.target.value as EngineId)} aria-label={label}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
      {hint && <span className="control-hint">{hint}</span>}
    </label>
  );
}

function ControlGroup({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="control-group">
      <h2>
        <span className="control-group-index">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`stat${warn ? " warn" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checks: every viability rule as a pass / warn / fail row.
// ---------------------------------------------------------------------------

type CheckStatus = "pass" | "warn" | "fail";

const CHECK_ROWS: { label: string; ids: string[] }[] = [
  { label: "Static stability", ids: ["static_margin"] },
  { label: "Structural slenderness", ids: ["slenderness_warning", "slenderness_limit"] },
  { label: "Engine packing", ids: ["engine_packing"] },
  { label: "Sea-level ignition", ids: ["stage1_engine_not_sea_level"] },
];

function checkRows(checks: BuildCheck[]): { label: string; status: CheckStatus; message: string | null }[] {
  const rows = CHECK_ROWS.map(({ label, ids }) => {
    const hit = checks.find((c) => ids.includes(c.id));
    if (!hit) {
      return { label, status: "pass" as CheckStatus, message: null };
    }
    return { label, status: hit.severity === "error" ? ("fail" as CheckStatus) : ("warn" as CheckStatus), message: hit.message };
  });
  const known = new Set(CHECK_ROWS.flatMap((r) => r.ids));
  for (const c of checks) {
    if (!known.has(c.id)) {
      rows.push({ label: "Configuration", status: c.severity === "error" ? "fail" : "warn", message: c.message });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Studio preview
// ---------------------------------------------------------------------------

/** Image-based lighting from a synthetic room, so the bells and tanks pick up reflections. */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => environment.dispose(), [environment]);
  return <primitive attach="environment" object={environment} />;
}

function floorTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "#1a2029");
  g.addColorStop(0.45, "#0d1117");
  g.addColorStop(1, "#05070a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (const r of [0.12, 0.24, 0.36, 0.48]) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r * size, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Floor({ total }: { total: number }) {
  const texture = useMemo(() => floorTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
      <circleGeometry args={[total * 2.2, 64]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

/** A height scale beside the vehicle. */
function HeightGauge({ total, radius }: { total: number; radius: number }) {
  const x = -(radius + Math.max(1.2, total * 0.08));
  const ticks = useMemo(() => {
    const step = total > 80 ? 20 : 10;
    const out: number[] = [];
    for (let h = 0; h <= total; h += step) {
      out.push(h);
    }
    return { step, values: out };
  }, [total]);
  const geometry = useMemo(() => {
    const pts: number[] = [x, 0, 0, x, total, 0];
    for (const h of ticks.values) {
      pts.push(x, h, 0, x + 0.5, h, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [x, total, ticks]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const labels = [0, total];
  return (
    <group>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#3b4658" transparent opacity={0.9} />
      </lineSegments>
      {labels.map((h) => (
        <Html key={h} position={[x - 0.4, h, 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: "none" }}>
          <span className="gauge-label">{h === 0 ? "0 m" : `${h.toFixed(1)} m`}</span>
        </Html>
      ))}
    </group>
  );
}

/** Keeps the vehicle framed as its length changes, without fighting the user's orbit. */
function FrameRocket({ total, controls }: { total: number; controls: React.RefObject<OrbitControlsRef | null> }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const c = controls.current;
    if (!c) {
      return;
    }
    const target = new THREE.Vector3(0, total * 0.48, 0);
    const dir = camera.position.clone().sub(c.target);
    if (dir.lengthSq() < 1e-6) {
      dir.set(1, 0.4, 1.1);
    }
    dir.setLength(total * 2.05);
    c.target.copy(target);
    camera.position.copy(target).add(dir);
    c.update();
  }, [total, camera, controls]);
  return null;
}

function VehiclePreview({ derived, reducedMotion }: { derived: DerivedRocket; reducedMotion: boolean }) {
  const controls = useRef<OrbitControlsRef | null>(null);
  const total = derived.totalLengthM;
  const shadowKey = `${total.toFixed(2)}:${derived.diameterM.toFixed(2)}:${derived.fins.spanM.toFixed(2)}:${derived.stage1.engineCount}`;
  const cameraProps = useMemo(
    () => ({ position: [total * 1.1, total * 0.85, total * 1.25] as [number, number, number], fov: 36, near: 0.1, far: 5000 }),
    // Only the initial framing; FrameRocket follows changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <SafeCanvas camera={cameraProps} dpr={[1, 2]} gl={{ antialias: true }} scene={{ environmentIntensity: 0.5 }}>
      <color attach="background" args={["#05070a"]} />
      <fog attach="fog" args={["#05070a", total * 3.5, total * 9]} />
      <StudioEnvironment />
      <hemisphereLight args={["#8fb4d8", "#141210", 0.35]} />
      <directionalLight position={[total * 0.8, total * 1.3, total * 0.7]} intensity={1.7} color="#fff1dc" />
      <directionalLight position={[-total, total * 0.35, -total * 0.8]} intensity={0.55} color="#7fb0ff" />
      <RocketMesh rocket={derived} showMarkers />
      {/* Re-baked (via the key) only when the build changes, not every frame. */}
      <ContactShadows
        key={shadowKey}
        frames={2}
        position={[0, -0.03, 0]}
        scale={total * 1.4}
        blur={2.2}
        opacity={0.6}
        far={total * 0.6}
        resolution={512}
      />
      <Floor total={total} />
      <HeightGauge total={total} radius={derived.diameterM / 2} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.45}
        minDistance={total * 0.5}
        maxDistance={total * 4}
        maxPolarAngle={Math.PI * 0.53}
        target={[0, total * 0.46, 0]}
      />
      <FrameRocket total={total} controls={controls} />
    </SafeCanvas>
  );
}

// ---------------------------------------------------------------------------

const STAGE1_ENGINES: { id: EngineId; name: string; note: string }[] = [
  { id: "booster", name: "B-1 Booster", note: "high thrust" },
  { id: "sustainer", name: "S-2 Sustainer", note: "efficient, lighter" },
];

const STAGE2_ENGINES: { id: EngineId; name: string; note: string }[] = [
  { id: "cryogenic", name: "H-1 Cryogenic", note: "440 s vacuum" },
  { id: "vacuum", name: "V-9 Vacuum", note: "345 s vacuum" },
  { id: "sustainer", name: "S-2 Sustainer", note: "335 s vacuum" },
];

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
    settings,
    earthWeather,
    setEarthWeather,
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
      settings: s.settings,
      earthWeather: s.earthWeather,
      setEarthWeather: s.setEarthWeather,
    })),
  );
  const pythonStatus = usePythonBackendStatus();
  const [presetId, setPresetId] = useState("");

  const errors = derived.checks.filter((c: BuildCheck) => c.severity === "error");
  const canLaunch = errors.length === 0 && !flightLoading;
  const rows = useMemo(() => checkRows(derived.checks), [derived.checks]);
  const failures = rows.filter((r) => r.status !== "pass").length;

  useEffect(() => {
    if (!suggestedExperiment) {
      return;
    }
    const input = document.querySelector<HTMLElement>(".suggested-control input, .suggested-control select");
    input?.focus();
  }, [suggestedExperiment]);

  const total = derived.totalLengthM;

  return (
    <div className="screen assembly">
      <div className="viewport assembly-viewport">
        <VehiclePreview derived={derived} reducedMotion={settings.reducedMotion} />

        <div className="viewport-overlay">
          <p className="kicker">Vehicle preview</p>
          <p className="viewport-dims">
            <span>{total.toFixed(1)} m</span>
            <span className="sep">·</span>
            <span>{derived.diameterM.toFixed(1)} m dia</span>
            <span className="sep">·</span>
            <span>{(derived.wetMassKg / 1000).toFixed(0)} t on the pad</span>
          </p>
        </div>
        <div className="viewport-caption">
          <span className="cyan">●</span> center of mass <span className="orange">●</span> center of pressure
          <span className="viewport-hint">drag to orbit · scroll to zoom</span>
        </div>

        {/* Side-profile inset showing the complete stack. */}
        <div className="side-inset">
          <SafeCanvas orthographic camera={{ position: [total * 1.4, total / 2, 0], zoom: 18 }}>
            <color attach="background" args={["#080b10"]} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 10, 5]} intensity={1.1} />
            <RocketMesh rocket={derived} />
          </SafeCanvas>
          <div className="inset-caption">Side profile</div>
        </div>
      </div>

      <aside className="panel">
        <header className="panel-head">
          <p className="kicker">Orbital mission simulator</p>
          <h1>
            APOGEE <span className="dim">/ Launch Lab</span>
          </h1>
          <NarratedText className="objective">
            <strong>Launch objective.</strong> Deliver useful mission mass into a 180–220 × 180–250 km parking orbit,
            then complete the lunar transfer. Perigee must stay above 150 km; structural max-Q is 45 kPa and payload
            load is 5 g.
          </NarratedText>
        </header>

        {experimentBaseline && suggestedExperiment && (
          <section className="experiment-card">
            <strong>Experiment baseline pinned</strong>
            <NarratedText
              narration={`Try one change: ${suggestedExperiment.label}. Compare the next flight with ${experimentBaseline.outcome.replaceAll("_", " ")}.`}
            >
              Try one change: {suggestedExperiment.label}. Compare the next flight with{" "}
              {experimentBaseline.outcome.replaceAll("_", " ")}.
            </NarratedText>
          </section>
        )}
        <ControlGroup index="00" title="Reference preset">
          <label className="control control-select">
            <span className="control-label">Rocket preset</span>
            <span className="select-wrap"><select value={presetId} onChange={(event) => {
              setPresetId(event.target.value);
              const preset = ROCKET_PRESETS.find((item) => item.id === event.target.value);
              if (preset) updateConfig(preset.settings);
            }}><option value="">Choose a calibrated profile</option>{ROCKET_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></span>
            <span className="control-hint">A preset replaces every editable vehicle parameter with its compatible scenario configuration.</span>
          </label>
          {presetId && <p className="dim small">{ROCKET_PRESETS.find((preset) => preset.id === presetId)?.summary}</p>}
        </ControlGroup>

        <ControlGroup index="01" title="Payload">
          <Slider
            label="Mission payload (dry)"
            value={config.payloadDryMassKg}
            min={CONFIG_RANGES.payloadDryMassKg.min}
            max={CONFIG_RANGES.payloadDryMassKg.max}
            step={CONFIG_RANGES.payloadDryMassKg.step}
            unit="kg"
            onChange={(v) => updateConfig({ payloadDryMassKg: v })}
            onCommit={persistBuild}
            format={(v) => `${(v / 1000).toFixed(1)} t`}
            hint="More delivered capability, but every kilogram must be accelerated to orbit."
            suggested={suggestedExperiment?.control === "payloadDryMassKg"}
          />
          <Slider
            label="Payload propellant"
            value={config.payloadPropellantKg}
            min={CONFIG_RANGES.payloadPropellantKg.min}
            max={CONFIG_RANGES.payloadPropellantKg.max}
            step={CONFIG_RANGES.payloadPropellantKg.step}
            unit="kg"
            onChange={(v) => updateConfig({ payloadPropellantKg: v })}
            onCommit={persistBuild}
            format={(v) => `${(v / 1000).toFixed(1)} t`}
            hint="Funds circularization and operations after launch, at the cost of ascent mass."
            suggested={suggestedExperiment?.control === "payloadPropellantKg"}
          />
        </ControlGroup>

        <ControlGroup index="02" title="Stage 1">
          <Slider
            label="Stage 1 propellant"
            value={config.stage1PropellantKg}
            min={CONFIG_RANGES.stage1PropellantKg.min}
            max={CONFIG_RANGES.stage1PropellantKg.max}
            step={CONFIG_RANGES.stage1PropellantKg.step}
            unit="kg"
            onChange={(v) => updateConfig({ stage1PropellantKg: v })}
            onCommit={persistBuild}
            format={(v) => `${(v / 1000).toFixed(0)} t`}
            hint="Sets tank length, and with it slenderness."
          />
          <Slider
            label="Stage 1 engines"
            value={config.stage1EngineCount}
            min={CONFIG_RANGES.stage1EngineCount.min}
            max={CONFIG_RANGES.stage1EngineCount.max}
            step={1}
            unit=""
            onChange={(v) => updateConfig({ stage1EngineCount: Math.round(v) })}
            onCommit={persistBuild}
            format={(v) => `${v} ×`}
            hint="Thrust, dry mass and fuel flow; excess thrust raises max-Q and g-load."
            suggested={suggestedExperiment?.control === "stage1EngineCount"}
          />
          <EngineSelect
            label="Stage 1 engine"
            value={config.stage1Engine}
            options={STAGE1_ENGINES}
            onChange={(id) => {
              updateConfig({ stage1Engine: id });
              persistBuild();
            }}
          />
        </ControlGroup>

        <ControlGroup index="03" title="Stage 2">
          <Slider
            label="Stage 2 propellant"
            value={config.stage2PropellantKg}
            min={CONFIG_RANGES.stage2PropellantKg.min}
            max={CONFIG_RANGES.stage2PropellantKg.max}
            step={CONFIG_RANGES.stage2PropellantKg.step}
            unit="kg"
            onChange={(v) => updateConfig({ stage2PropellantKg: v })}
            onCommit={persistBuild}
            format={(v) => `${(v / 1000).toFixed(0)} t`}
            suggested={suggestedExperiment?.control === "stage2PropellantKg"}
          />
          <EngineSelect
            label="Stage 2 engine"
            value={config.stage2Engine}
            options={STAGE2_ENGINES}
            onChange={(id) => {
              updateConfig({ stage2Engine: id });
              persistBuild();
            }}
            hint="Vacuum engines want to ignite high; sea-level engines are compact but weak up there."
          />
        </ControlGroup>

        <ControlGroup index="04" title="Aero">
          <Slider
            label="Body diameter"
            value={config.diameterM}
            min={CONFIG_RANGES.diameterM.min}
            max={CONFIG_RANGES.diameterM.max}
            step={CONFIG_RANGES.diameterM.step}
            unit="m"
            onChange={(v) => updateConfig({ diameterM: v })}
            onCommit={persistBuild}
            format={(v) => `${v.toFixed(1)} m`}
            hint="Wide fits engines and shortens tanks, but adds drag and fairing mass."
            suggested={suggestedExperiment?.control === "diameterM"}
          />
          <Slider
            label="Fin span"
            value={config.finSpanM}
            min={CONFIG_RANGES.finSpanM.min}
            max={CONFIG_RANGES.finSpanM.max}
            step={CONFIG_RANGES.finSpanM.step}
            unit="m"
            onChange={(v) => updateConfig({ finSpanM: v })}
            onCommit={persistBuild}
            format={(v) => `${v.toFixed(1)} m`}
            hint="Moves the center of pressure aft for stability, at a cost in mass and drag."
            suggested={suggestedExperiment?.control === "finSpanM"}
          />
        </ControlGroup>
        <ControlGroup index="05" title="Earth weather">
          <Slider label="Temperature" value={earthWeather.temperatureC} min={-20} max={45} step={1} unit="°C" onChange={(temperatureC) => setEarthWeather({ temperatureC })} onCommit={persistBuild} />
          <Slider label="Surface pressure" value={earthWeather.pressureHpa} min={850} max={1050} step={1} unit="hPa" onChange={(pressureHpa) => setEarthWeather({ pressureHpa })} onCommit={persistBuild} />
          <Slider label="Relative humidity" value={earthWeather.relativeHumidityPct} min={0} max={100} step={1} unit="%" onChange={(relativeHumidityPct) => setEarthWeather({ relativeHumidityPct })} onCommit={persistBuild} />
          <Slider label="Sustained wind" value={earthWeather.windSpeedMs} min={0} max={30} step={0.5} unit="m/s" onChange={(windSpeedMs) => setEarthWeather({ windSpeedMs })} onCommit={persistBuild} />
          <Slider label="Crosswind" value={earthWeather.crosswindMs} min={0} max={25} step={0.5} unit="m/s" onChange={(crosswindMs) => setEarthWeather({ crosswindMs })} onCommit={persistBuild} />
          <Slider label="Wind gust" value={earthWeather.windGustMs} min={0} max={35} step={0.5} unit="m/s" onChange={(windGustMs) => setEarthWeather({ windGustMs })} onCommit={persistBuild} />
          <Slider label="Rain rate" value={earthWeather.precipitationMmH} min={0} max={20} step={0.1} unit="mm/h" onChange={(precipitationMmH) => setEarthWeather({ precipitationMmH })} onCommit={persistBuild} />
          <Slider label="Visibility" value={earthWeather.visibilityKm} min={0.1} max={30} step={0.1} unit="km" onChange={(visibilityKm) => setEarthWeather({ visibilityKm })} onCommit={persistBuild} />
          <Slider label="Convective energy" value={earthWeather.capeJKg} min={0} max={3000} step={50} unit="J/kg" onChange={(capeJKg) => setEarthWeather({ capeJKg })} onCommit={persistBuild} />
          <p className="control-hint">Wind and density affect the solver; storm, rain, visibility, gust, and CAPE conditions remain explicit operational factors in the debrief.</p>
        </ControlGroup>

        <section className="stat-strip" aria-label="Derived values">
          <Stat label="Liftoff TWR" value={derived.liftoffTwr.toFixed(2)} warn={derived.liftoffTwr <= 1} />
          <Stat label="Ideal Δv" value={`${(derived.totalIdealDeltaVMs / 1000).toFixed(1)} km/s`} />
          <Stat label="Wet mass" value={`${(derived.wetMassKg / 1000).toFixed(0)} t`} />
          <Stat label="Useful payload" value={`${(config.payloadDryMassKg / 1000).toFixed(1)} t`} />
          <Stat label="Stability" value={`${derived.staticMargin.toFixed(2)} cal`} warn={derived.staticMargin < 1} />
          <Stat label="Slenderness" value={derived.slenderness.toFixed(1)} warn={derived.slenderness > 15} />
        </section>

        <section className="checks" aria-label="Build checks">
          <h2>
            <span className="control-group-index">{failures === 0 ? "✓" : failures}</span>
            {failures === 0 ? "All checks pass" : failures === 1 ? "1 check needs attention" : `${failures} checks need attention`}
          </h2>
          {rows.map((row, i) => (
            <div key={i} className={`check-row ${row.status}`}>
              <span className="check-dot" aria-hidden="true" />
              <span className="check-body">
                <span className="check-label">{row.label}</span>
                {row.message && <span className="check-message">{row.message}</span>}
              </span>
              <span className="check-status">{row.status}</span>
            </div>
          ))}
          {flightError && (
            <NarratedText className="check error" narration={flightError}>
              ✕ {flightError}
            </NarratedText>
          )}
        </section>

        <div className="actions">
          <button className="launch" onClick={launch} disabled={!canLaunch}>
            {flightLoading ? "Computing…" : "LAUNCH"}
          </button>
          <button className="ghost" onClick={resetToReference}>
            Reset to reference build
          </button>
        </div>

        <footer className="panel-foot">
          {analysisStale && <p className="dim small">Build edited — prior analysis invalidated until rerun.</p>}
          <SpaceWeatherPanel snapshot={weather} />
          <p className="dim small">
            {pythonStatus === "up"
              ? "Payload analysis: Python"
              : pythonStatus === "down"
                ? "Payload analysis: local TypeScript"
                : "Checking Python backend…"}
          </p>
          {persistenceNotice && (
            <NarratedText className="check warning" narration={persistenceNotice}>
              ⚠ {persistenceNotice}
            </NarratedText>
          )}
          <SettingsToggle />
        </footer>
      </aside>
    </div>
  );
}
