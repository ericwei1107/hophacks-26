from dataclasses import dataclass, field
from pathlib import Path
import csv
import io
import zipfile

import requests

from design import SpacecraftMission

ZENODO_RECORD_URL = "https://zenodo.org/api/records/21667787"
ZENODO_DOI = "10.5281/zenodo.21667787"
DATASET_TITLE = "Inventory of Global Emissions by Launchers for 2024 (IGEL 2024)"
CITATION = (
    "Herberhold et al. (2026). Inventory of Global Emissions by Launchers "
    f"for 2024. Zenodo. https://doi.org/{ZENODO_DOI}"
)

CACHE_DIR = Path(__file__).resolve().parent / "data" / "igel_2024"
ARCHIVE_NAME = "IGEL_2024.zip"
LAUNCH_LIST_MEMBER = "IGEL_2024/input_data/Launch_List.csv"
VEHICLE_DATA_MEMBER = "IGEL_2024/input_data/Launch_Vehicle_Data.csv"
EMISSION_PROFILE_TEMPLATE = (
    "IGEL_2024/inventory/final_emission_profiles/{tag}_final_emission_profile.csv"
)

# Approximate reusable / typical LEO payload. Fallback is 3% of vehicle GLOW.
KNOWN_PAYLOAD_KG = {
    "Angara-1.2": 3700.0,
    "Angara A5Orio": 24500.0,
    "Ariane 62": 10300.0,
    "Chang Zheng 2C": 3850.0,
    "Chang Zheng 2D": 3500.0,
    "Chang Zheng 2F": 8100.0,
    "Chang Zheng 3B": 11500.0,
    "Chang Zheng 4B": 4200.0,
    "Chang Zheng 4C": 4200.0,
    "Chang Zheng 5": 14000.0,
    "Chang Zheng 5B": 23000.0,
    "Chang Zheng 6": 1080.0,
    "Chang Zheng 6A": 4000.0,
    "Chang Zheng 7": 13500.0,
    "Chang Zheng 7A": 7000.0,
    "Delta 4H": 23000.0,
    "Electron": 300.0,
    "Falcon 9": 15500.0,
    "Falcon Heavy": 50000.0,
    "H-IIA 202": 10000.0,
    "H3-22S": 4000.0,
    "Soyuz-2-1A": 7000.0,
    "Soyuz-2-1B": 8200.0,
    "Starship V1.0": 100000.0,
    "Vulcan Centaur": 27000.0
}

CLIMATE_SPECIES = ("CO2", "CH4", "C")
OZONE_SPECIES = ("NO", "HCL", "CL", "CL2")
PARTICLE_SPECIES = ("C", "AL2O3")
CH4_GWP100 = 28.0

@dataclass
class AnalogLaunch:
    tag: str
    vehicle: str
    mission: str
    date: str
    perigee_km: float
    apogee_km: float
    inclination_deg: float
    score: float

@dataclass
class EmissionTotals:
    total_kg: float = 0.0
    species_kg: dict[str, float] = field(default_factory = dict)
    by_layer_kg: dict[str, float] = field(default_factory = dict)

@dataclass
class MissionFootprint:
    analog: AnalogLaunch
    similar_count: int
    payload_capacity_kg: float
    spacecraft_wet_mass_kg: float
    payload_share: float
    full_launch: EmissionTotals
    attributed: EmissionTotals
    co2e_attributed_kg: float
    source: str = DATASET_TITLE
    doi: str = ZENODO_DOI
    citation: str = CITATION

def _cache_path() -> Path:
    CACHE_DIR.mkdir(parents = True, exist_ok = True)
    return CACHE_DIR / ARCHIVE_NAME

def fetch_igel_archive(timeout: int = 180) -> Path:
    path = _cache_path()
    if path.exists() and path.stat().st_size > 1_000_000:
        return path

    record = requests.get(ZENODO_RECORD_URL, timeout = 30)
    record.raise_for_status()
    files = record.json().get("files") or []
    if not files:
        raise RuntimeError("Zenodo record 21667787 did not list any files.")

    download_url = files[0]["links"]["self"]
    response = requests.get(download_url, stream = True, timeout = timeout)
    response.raise_for_status()

    partial = path.with_suffix(".partial")
    with partial.open("wb") as handle:
        for chunk in response.iter_content(chunk_size = 256 * 1024):
            if chunk:
                handle.write(chunk)
    partial.replace(path)
    return path

def _open_member(archive: Path, member: str) -> str:
    with zipfile.ZipFile(archive) as bundle:
        return bundle.read(member).decode("utf-8", errors = "replace")

def _float(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None

def _mean_altitude_km(row: dict) -> float | None:
    perigee = _float(row.get("Insertion_Perigee_Alt"))
    apogee = _float(row.get("Insertion_Apogee_Alt"))
    if perigee is None or apogee is None:
        return None
    if min(perigee, apogee) < 80 or max(perigee, apogee) > 4000:
        return None
    return 0.5 * (perigee + apogee)

def _vehicle_glow_kg(row: dict) -> float:
    total = 0.0
    for key, value in row.items():
        if key.endswith("_Mass"):
            mass = _float(value)
            if mass:
                total += mass
    return total

def _payload_capacity_kg(vehicle: str, vehicle_rows: dict[str, dict]) -> float:
    if vehicle in KNOWN_PAYLOAD_KG:
        return KNOWN_PAYLOAD_KG[vehicle]
    glow = _vehicle_glow_kg(vehicle_rows.get(vehicle, {}))
    return max(glow * 0.03, 1.0)

def load_launch_catalog(archive: Path | None = None) -> tuple[list[dict], dict[str, dict]]:
    archive = archive or fetch_igel_archive()
    launches = list(csv.DictReader(io.StringIO(_open_member(archive, LAUNCH_LIST_MEMBER))))
    vehicles = {
        row["LV_Type"]: row
        for row in csv.DictReader(io.StringIO(_open_member(archive, VEHICLE_DATA_MEMBER)))
    }
    return launches, vehicles

def _orbit_score(mission: SpacecraftMission, row: dict) -> float | None:
    mean_alt = _mean_altitude_km(row)
    inclination = _float(row.get("Insertion_Inclination"))
    if mean_alt is None or inclination is None:
        return None
    altitude_error = (mean_alt - mission.target_altitude) / 100.0
    inclination_error = (inclination - mission.target_inclination) / 10.0
    return altitude_error ** 2 + inclination_error ** 2

def find_analog_launches(
    mission: SpacecraftMission,
    launches: list[dict],
    vehicles: dict[str, dict] | None = None,
    limit: int = 8
) -> list[AnalogLaunch]:
    wet_mass = mission.mass + max(mission.fuel, 0.0)
    vehicle_rows = vehicles or {}
    scored = []
    for row in launches:
        score = _orbit_score(mission, row)
        if score is None:
            continue
        capacity = _payload_capacity_kg(row["LV_Type"], vehicle_rows)
        if capacity + 1e-9 < wet_mass:
            continue
        scored.append(
            AnalogLaunch(
                tag = row["Launch_Tag"],
                vehicle = row["LV_Type"],
                mission = row.get("Mission") or row.get("Flight") or "",
                date = row.get("Launch_Date", "").strip(),
                perigee_km = _float(row["Insertion_Perigee_Alt"]) or 0.0,
                apogee_km = _float(row["Insertion_Apogee_Alt"]) or 0.0,
                inclination_deg = _float(row["Insertion_Inclination"]) or 0.0,
                score = score
            )
        )
    scored.sort(key = lambda item: item.score)
    if scored:
        return scored[:limit]

    # If no vehicle in the catalog can lift this spacecraft, still return the
    # closest orbit match so the footprint path does not fail closed.
    fallback = []
    for row in launches:
        score = _orbit_score(mission, row)
        if score is None:
            continue
        fallback.append(
            AnalogLaunch(
                tag = row["Launch_Tag"],
                vehicle = row["LV_Type"],
                mission = row.get("Mission") or row.get("Flight") or "",
                date = row.get("Launch_Date", "").strip(),
                perigee_km = _float(row["Insertion_Perigee_Alt"]) or 0.0,
                apogee_km = _float(row["Insertion_Apogee_Alt"]) or 0.0,
                inclination_deg = _float(row["Insertion_Inclination"]) or 0.0,
                score = score
            )
        )
    fallback.sort(key = lambda item: item.score)
    return fallback[:limit]

def _layer_name(altitude_km: float) -> str:
    if altitude_km < 15:
        return "troposphere_0_15km"
    if altitude_km < 50:
        return "stratosphere_15_50km"
    if altitude_km < 80:
        return "mesosphere_50_80km"
    return "above_80km"

def sum_launch_emissions(tag: str, archive: Path | None = None) -> EmissionTotals:
    archive = archive or fetch_igel_archive()
    member = EMISSION_PROFILE_TEMPLATE.format(tag = tag)
    text = _open_member(archive, member)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise RuntimeError(f"No emission rows for launch {tag}.")

    species_keys = [key for key in rows[0].keys() if key.startswith("species_mass_")]
    totals = EmissionTotals()
    for row in rows:
        mid_altitude = ((_float(row.get("ALTITUDE_MIN")) or 0.0) + (_float(row.get("ALTITUDE_MAX")) or 0.0)) / 2
        layer = _layer_name(mid_altitude)
        row_total = _float(row.get("species_mass_Total")) or 0.0
        totals.total_kg += row_total
        totals.by_layer_kg[layer] = totals.by_layer_kg.get(layer, 0.0) + row_total
        for key in species_keys:
            name = key.removeprefix("species_mass_")
            if name == "Total":
                continue
            mass = _float(row.get(key)) or 0.0
            if mass:
                totals.species_kg[name] = totals.species_kg.get(name, 0.0) + mass
    return totals

def _scale_totals(totals: EmissionTotals, share: float) -> EmissionTotals:
    return EmissionTotals(
        total_kg = totals.total_kg * share,
        species_kg = {name: mass * share for name, mass in totals.species_kg.items()},
        by_layer_kg = {layer: mass * share for layer, mass in totals.by_layer_kg.items()}
    )

def _co2e_kg(totals: EmissionTotals) -> float:
    co2 = totals.species_kg.get("CO2", 0.0)
    ch4 = totals.species_kg.get("CH4", 0.0)
    return co2 + CH4_GWP100 * ch4

def estimate_mission_footprint(mission: SpacecraftMission, archive: Path | None = None) -> MissionFootprint:
    archive = archive or fetch_igel_archive()
    launches, vehicles = load_launch_catalog(archive)
    analogs = find_analog_launches(mission, launches, vehicles)
    if not analogs:
        raise RuntimeError("IGEL 2024 has no valid LEO analog for this orbit.")

    analog = analogs[0]
    full_launch = sum_launch_emissions(analog.tag, archive)
    payload_capacity = _payload_capacity_kg(analog.vehicle, vehicles)
    wet_mass = mission.mass + max(mission.fuel, 0.0)
    share = min(1.0, wet_mass / payload_capacity)
    attributed = _scale_totals(full_launch, share)

    similar_count = sum(1 for item in analogs if item.score <= 2.0)
    return MissionFootprint(
        analog = analog,
        similar_count = max(similar_count, 1),
        payload_capacity_kg = payload_capacity,
        spacecraft_wet_mass_kg = wet_mass,
        payload_share = share,
        full_launch = full_launch,
        attributed = attributed,
        co2e_attributed_kg = _co2e_kg(attributed)
    )

def _format_mass(kg: float) -> str:
    if abs(kg) >= 1000:
        return f" {kg / 1000:.2f} t"
    return f" {kg:.1f} kg"

def _print_species(totals: EmissionTotals, names: tuple[str, ...]) -> None:
    for name in names:
        mass = totals.species_kg.get(name)
        if mass:
            print(f"    {name}: {_format_mass(mass)}")

def print_footprint(footprint: MissionFootprint) -> None:
    analog = footprint.analog
    print("\nLaunch environmental footprint")
    print(f"  Source: {footprint.source}")
    print(f"  DOI: https://doi.org/{footprint.doi}")
    print(
        f"  Analog launch: {analog.vehicle} {analog.tag} "
        f"({analog.date.strip()}, {analog.mission})"
    )
    print(
        f"  Analog insertion: {analog.perigee_km:.0f} x {analog.apogee_km:.0f} km "
        f"at {analog.inclination_deg:.1f} deg"
    )
    print(f"  Nearby 2024 analogs scored: {footprint.similar_count}")
    print(
        f"  Payload share: {footprint.spacecraft_wet_mass_kg:.0f} kg / "
        f"{footprint.payload_capacity_kg:.0f} kg "
        f"({footprint.payload_share:.2%})"
    )

    print("\n  Full analog launch")
    print(f"    Total exhaust: {_format_mass(footprint.full_launch.total_kg)}")
    _print_species(footprint.full_launch, ("CO2", "H2O", "CO", "C", "CH4", "NO", "HCL", "AL2O3"))

    print("\n  Attributed to this spacecraft")
    print(f"    Total exhaust: {_format_mass(footprint.attributed.total_kg)}")
    print(f"    CO2e (CO2 + 28 x CH4): {_format_mass(footprint.co2e_attributed_kg)}")
    _print_species(footprint.attributed, ("CO2", "H2O", "CO", "C", "CH4", "NO", "HCL", "AL2O3"))

    if footprint.attributed.by_layer_kg:
        print("\n  Attributed exhaust by altitude")
        layer_order = (
            "troposphere_0_15km",
            "stratosphere_15_50km",
            "mesosphere_50_80km",
            "above_80km"
        )
        for layer in layer_order:
            mass = footprint.attributed.by_layer_kg.get(layer)
            if mass:
                print(f"    {layer}: {_format_mass(mass)}")

    print(f"\n  Cite: {footprint.citation}")
