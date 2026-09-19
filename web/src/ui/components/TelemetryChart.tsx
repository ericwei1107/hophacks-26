/**
 * Lightweight canvas telemetry chart with event markers and a synchronized
 * hover cursor. Canvas (not SVG) keeps thousands of samples cheap.
 */

import { useEffect, useRef } from "react";

import type { FlightEvent, Telemetry } from "../../sim/ascent/flight";

export interface ChartChannel {
  label: string;
  unit: string;
  color: string;
  /** Extract the channel value at sample i. */
  value: (t: Telemetry, i: number) => number;
}

export function TelemetryChart({
  telemetry,
  channel,
  events,
  hoverTimeS,
  onHover,
}: {
  telemetry: Telemetry;
  channel: ChartChannel;
  events: FlightEvent[];
  hoverTimeS: number | null;
  onHover: (timeS: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(dpr, dpr);

    const n = telemetry.sampleCount;
    const duration = telemetry.tS[n - 1] || 1;

    // Channel range.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = channel.value(telemetry, i);
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (!Number.isFinite(min) || min === max) {
      min = 0;
      max = 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const xOf = (t: number) => (t / duration) * width;
    const yOf = (v: number) => height - ((v - min) / (max - min)) * height;

    // Background.
    ctx.fillStyle = "#0d1a2b";
    ctx.fillRect(0, 0, width, height);

    // Event markers.
    ctx.strokeStyle = "rgba(99, 221, 235, 0.25)";
    ctx.lineWidth = 1;
    for (const e of events) {
      ctx.beginPath();
      ctx.moveTo(xOf(e.t), 0);
      ctx.lineTo(xOf(e.t), height);
      ctx.stroke();
    }

    // Channel trace.
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = channel.value(telemetry, i);
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const x = xOf(telemetry.tS[i]);
      const y = yOf(v);
      if (started) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();

    // Hover cursor.
    if (hoverTimeS !== null) {
      ctx.strokeStyle = "rgba(232, 228, 218, 0.5)";
      ctx.beginPath();
      ctx.moveTo(xOf(hoverTimeS), 0);
      ctx.lineTo(xOf(hoverTimeS), height);
      ctx.stroke();
    }

    // Labels.
    ctx.fillStyle = "#8a97a8";
    ctx.font = "10px monospace";
    ctx.fillText(`${channel.label} (${channel.unit})`, 6, 12);
    ctx.fillText(max.toFixed(1), 6, 24);
    ctx.fillText(min.toFixed(1), 6, height - 4);
  }, [telemetry, channel, events, hoverTimeS]);

  return (
    <canvas
      ref={canvasRef}
      className="chart"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        const duration = telemetry.tS[telemetry.sampleCount - 1] || 1;
        onHover(Math.max(0, Math.min(duration, fraction * duration)));
      }}
      onMouseLeave={() => onHover(null)}
    />
  );
}
