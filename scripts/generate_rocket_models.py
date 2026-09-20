"""Generate display-scale CAD models for every Launch Lab rocket preset.

Run with ``python scripts/generate_rocket_models.py``.  Models are intentionally
stylized, dimensionally driven representations of the fictional game vehicles,
not engineering drawings of their real-world inspiration.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from build123d import Box, Compound, Cone, Cylinder, Location, export_step, export_stl


ROOT = Path(__file__).resolve().parents[1]
PRESETS = ROOT / "web" / "src" / "data" / "rocket-presets.json"
OUTPUT = ROOT / "models" / "rockets"
SCALE = 1 / 100  # source dimensions are metres; CAD output is millimetres.


def at(shape, x: float = 0, y: float = 0, z: float = 0):
    return shape.moved(Location((x, y, z)))


def rocket_model(settings: dict[str, float | int | str]) -> Compound:
    """Build a clean multi-solid launch-vehicle silhouette from a preset."""
    diameter = float(settings["diameterM"]) * 1_000 * SCALE
    radius = diameter / 2
    stage1_propellant = float(settings["stage1PropellantKg"])
    stage2_propellant = float(settings["stage2PropellantKg"])
    fin_span = float(settings["finSpanM"]) * 1_000 * SCALE
    engine_count = int(settings["stage1EngineCount"])

    stage1_length = diameter * (2.8 + min(2.4, stage1_propellant / 180_000))
    stage2_length = diameter * (1.7 + min(1.2, stage2_propellant / 80_000))
    interstage_length = diameter * 0.28
    fairing_length = diameter * 1.55
    parts = [
        at(Cylinder(radius, stage1_length), z=stage1_length / 2),
        at(Cone(radius, radius * 0.82, interstage_length), z=stage1_length + interstage_length / 2),
        at(Cylinder(radius * 0.82, stage2_length), z=stage1_length + interstage_length + stage2_length / 2),
        at(Cone(radius * 0.82, 0, fairing_length), z=stage1_length + interstage_length + stage2_length + fairing_length / 2),
    ]

    # Four radial stabilizers. The thin dimension faces the airflow.
    fin_chord = diameter * 0.95
    fin_height = max(diameter * 0.16, fin_span * 0.55)
    fin_thickness = max(diameter * 0.045, 0.45)
    for x_sign, y_sign in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if x_sign:
            parts.append(at(Box(fin_span, fin_thickness, fin_height), x=x_sign * (radius + fin_span / 2), z=fin_height / 2))
        else:
            parts.append(at(Box(fin_thickness, fin_span, fin_height), y=y_sign * (radius + fin_span / 2), z=fin_height / 2))

    # Engine bells are separate solids, distributed around the base.
    bell_radius = max(radius * 0.12, 0.8)
    ring_radius = 0 if engine_count == 1 else radius * 0.48
    for index in range(engine_count):
        angle = 2 * 3.141592653589793 * index / engine_count
        x = ring_radius * math.cos(angle)
        y = ring_radius * math.sin(angle)
        parts.append(at(Cone(bell_radius * 0.58, bell_radius, diameter * 0.32), x=x, y=y, z=-diameter * 0.16))
    return Compound(children=parts)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    presets = json.loads(PRESETS.read_text(encoding="utf-8"))
    for preset in presets:
        model = rocket_model(preset["settings"])
        stem = OUTPUT / preset["id"]
        export_step(model, stem.with_suffix(".step"))
        export_stl(model, stem.with_suffix(".stl"), tolerance=0.08, angular_tolerance=0.15)
        print(f"Generated {stem.name}.step and {stem.name}.stl")


if __name__ == "__main__":
    main()
