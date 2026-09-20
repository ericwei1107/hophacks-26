from pathlib import Path

import pytest

from design import SpacecraftMission
from emissions import (
    find_analog_launches,
    load_launch_catalog,
    estimate_mission_footprint,
    _orbit_score,
)


CACHE = Path(__file__).resolve().parents[1] / "data" / "igel_2024" / "IGEL_2024.zip"


pytestmark = pytest.mark.skipif(
    not CACHE.exists(),
    reason = "IGEL 2024 archive is not cached locally"
)


def test_catalog_loads_2024_launches():
    launches, vehicles = load_launch_catalog(CACHE)
    assert len(launches) >= 200
    assert "Falcon 9" in vehicles


def test_orbit_score_prefers_closer_inclination():
    mission = SpacecraftMission(750, 200, 5, 500, 53.0, 10, 2.2, 325)
    close = {"Insertion_Perigee_Alt": "450", "Insertion_Apogee_Alt": "550", "Insertion_Inclination": "53.2"}
    far = {"Insertion_Perigee_Alt": "450", "Insertion_Apogee_Alt": "550", "Insertion_Inclination": "98.0"}
    assert _orbit_score(mission, close) < _orbit_score(mission, far)


def test_footprint_scales_with_spacecraft_mass():
    small = SpacecraftMission(500, 100, 5, 500, 53.0, 8, 2.0, 300)
    large = SpacecraftMission(1000, 300, 5, 500, 53.0, 8, 2.0, 300)
    small_foot = estimate_mission_footprint(small, CACHE)
    large_foot = estimate_mission_footprint(large, CACHE)
    assert small_foot.attributed.total_kg < large_foot.attributed.total_kg
    assert small_foot.full_launch.species_kg["CO2"] > 0
    assert 0 < small_foot.payload_share <= 1


def test_analog_search_returns_leo_match():
    mission = SpacecraftMission(750, 200, 5, 550, 53.0, 10, 2.2, 325)
    launches, vehicles = load_launch_catalog(CACHE)
    analogs = find_analog_launches(mission, launches, vehicles, limit=3)
    assert analogs
    assert analogs[0].perigee_km > 80
