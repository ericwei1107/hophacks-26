"""Interpretable scenario matching backed by the three supplied workbooks.

The workbooks are a curated reference model, not a statistical training set.
This module keeps the matching rules explicit so the UI can show the source
scenario and operational mitigation for every result.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import ZipFile

from environment import SpaceWeather

DATA_DIR = Path(__file__).resolve().parent / "data"
WORKBOOKS = {
    "space_weather": (DATA_DIR / "space_weather" / "rocket_scenarios.xlsx", "Space Weather Scenarios"),
    "earth_weather": (DATA_DIR / "earth_weather" / "rocket_scenarios.xlsx", "Earth Weather Scenarios"),
    "rocketry": (DATA_DIR / "rocketry" / "sample_parameters.xlsx", "Rocket Parameters"),
}
_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _column_index(reference: str) -> int:
    result = 0
    for character in "".join(filter(str.isalpha, reference)):
        result = result * 26 + ord(character.upper()) - ord("A") + 1
    return result - 1


def _cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    inline = cell.find("x:is/x:t", _NS)
    if inline is not None:
        return inline.text or ""
    value = cell.find("x:v", _NS)
    if value is None:
        return ""
    if cell.get("t") == "s":
        return shared[int(value.text or "0")]
    return value.text or ""


@lru_cache(maxsize=3)
def load_scenarios(dataset: str) -> list[dict[str, str]]:
    """Load the first data sheet from an XLSX workbook using only stdlib."""
    path, expected_sheet = WORKBOOKS[dataset]
    with ZipFile(path) as workbook:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared = ["".join(item.itertext()) for item in root.findall("x:si", _NS)]
        root = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
        names = [item.get("name", "") for item in root.findall("x:sheets/x:sheet", _NS)]
        sheet_number = names.index(expected_sheet) + 1
        sheet = ElementTree.fromstring(workbook.read(f"xl/worksheets/sheet{sheet_number}.xml"))

    rows: list[list[str]] = []
    for row in sheet.findall("x:sheetData/x:row", _NS):
        values: list[str] = []
        for cell in row.findall("x:c", _NS):
            index = _column_index(cell.get("r", "A1"))
            values.extend([""] * max(0, index - len(values)))
            values.append(_cell_value(cell, shared).strip())
        rows.append(values)
    if not rows:
        return []
    headers = rows[0]
    return [dict(zip(headers, row + [""] * (len(headers) - len(row)))) for row in rows[1:] if any(row)]


def _match(dataset: str, scenario_id: str, *, confidence: float, evidence: list[str]) -> dict[str, Any]:
    row = next(item for item in load_scenarios(dataset) if item["ID"] == scenario_id)
    if dataset == "space_weather":
        return {
            "dataset": "spaceWeather",
            "scenarioId": scenario_id,
            "title": row["Space Weather Parameter"],
            "severity": row["NOAA Scale"],
            "impact": row["Effect on a Flying Rocket / Payload"],
            "systemsAffected": row["Systems Affected"],
            "mitigation": row["Mitigation / Operational Rule"],
            "source": row["Source URL"],
            "confidence": confidence,
            "evidence": evidence,
        }
    return {
        "dataset": "earthWeather",
        "scenarioId": scenario_id,
        "title": row["Weather Parameter"],
        "severity": row["Impact Category"],
        "impact": row["Effect on a Flying Rocket"],
        "systemsAffected": row["Flight Phase Most Affected"],
        "mitigation": row["Typical Launch Commit Criterion / Mitigation"],
        "source": row["Source URL"],
        "confidence": confidence,
        "evidence": evidence,
    }


def recognize_patterns(
    space_weather: SpaceWeather,
    earth_weather: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Match measured conditions to scenario records; unmatched conditions stay silent."""
    matches: list[dict[str, Any]] = []
    kp = space_weather.kp
    f107 = space_weather.f107
    speed = space_weather.solar_wind_speed
    density = space_weather.solar_wind_density
    if kp is not None and kp >= 5:
        scenario = "3" if kp >= 8 else "2"
        matches.append(_match("space_weather", scenario, confidence=min(1.0, kp / 9), evidence=[f"Kp {kp:g}"]))
    elif kp is not None and kp >= 4:
        matches.append(_match("space_weather", "1", confidence=0.7, evidence=[f"Kp {kp:g}"]))
    if speed is not None and speed >= 500:
        matches.append(_match("space_weather", "5", confidence=min(1.0, speed / 800), evidence=[f"solar wind {speed:g} km/s"]))
    if density is not None and density >= 10:
        matches.append(_match("space_weather", "6", confidence=min(1.0, density / 30), evidence=[f"solar wind density {density:g}/cm³"]))
    if (kp is not None and kp >= 5) or (f107 is not None and f107 >= 180):
        evidence = []
        if kp is not None:
            evidence.append(f"Kp {kp:g}")
        if f107 is not None:
            evidence.append(f"F10.7 {f107:g} sfu")
        matches.append(_match("space_weather", "28", confidence=0.8, evidence=evidence))
    if f107 is not None and f107 >= 180:
        matches.append(_match("space_weather", "30", confidence=min(1.0, f107 / 250), evidence=[f"F10.7 {f107:g} sfu"]))

    earth_weather = earth_weather or {}
    thresholds = (
        ("temperature_c", 35, "1", "≥"),
        ("temperature_c", 0, "2", "≤"),
        ("wind_speed_m_s", 10, "4", "≥"),
        ("wind_gust_m_s", 15, "5", "≥"),
        ("crosswind_m_s", 8, "6", "≥"),
        ("precipitation_mm_h", 0.1, "11", "≥"),
        ("visibility_km", 3, "14", "≤"),
        ("relative_humidity_pct", 95, "10", "≥"),
        ("cape_j_kg", 1000, "30", "≥"),
    )
    for field, limit, scenario, operator in thresholds:
        value = earth_weather.get(field)
        if value is None or not isinstance(value, (int, float)):
            continue
        matched = value >= limit if operator == "≥" else value <= limit
        if matched:
            matches.append(_match("earth_weather", scenario, confidence=0.85, evidence=[f"{field} {value:g} ({operator} {limit:g})"]))

    return {
        "modelVersion": "scenario-recognition-v1",
        "referenceRows": {key: len(load_scenarios(key)) for key in WORKBOOKS},
        "matches": matches,
    }


def rocket_catalog() -> list[dict[str, str]]:
    """Expose the curated vehicle catalog for selection and display in the UI."""
    return load_scenarios("rocketry")
