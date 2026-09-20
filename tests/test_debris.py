"""Offline tests for the SATCAT crowding screen."""
from debris import SYNTHETIC_SATCAT, cam_scale_from_counts, crowding_census, shell_census


def test_satcat_crowded_shell_exceeds_reference():
    census = shell_census(SYNTHETIC_SATCAT, 545)
    quiet = shell_census(SYNTHETIC_SATCAT, 400)
    assert census["counts"]["total"] > census["reference_counts"]["total"]
    assert census["counts"]["debris"] > 0
    assert census["cam_scale"] >= quiet["cam_scale"]


def test_cam_scale_is_clipped():
    assert cam_scale_from_counts(200, 100) == 2.0
    assert cam_scale_from_counts(10, 100) == 0.4


def test_synthetic_source_label():
    census = shell_census(SYNTHETIC_SATCAT, 545)
    assert census["source"] == "synthetic fallback"


def test_crowding_census_uses_injected_satcat(monkeypatch):
    monkeypatch.setattr("debris.load_satcat", lambda force_refresh=False: list(SYNTHETIC_SATCAT))
    census = crowding_census(545.0)
    assert census["counts"]["debris"] > 0
    assert census["cam_scale"] >= 1.0


def test_seeded_catalog_uncertainty_is_small_and_deterministic():
    exact = shell_census(SYNTHETIC_SATCAT, 400)
    a = shell_census(SYNTHETIC_SATCAT, 400, seed=7)
    b = shell_census(SYNTHETIC_SATCAT, 400, seed=7)
    other = shell_census(SYNTHETIC_SATCAT, 400, seed=99)
    assert a["cam_scale"] == b["cam_scale"]
    assert a["catalog_sigma"] == 0.0015
    assert exact["catalog_sigma"] == 0.0
    assert abs(a["cam_scale"] - exact["cam_scale"]) / max(exact["cam_scale"], 1e-9) < 0.02
    assert a["cam_scale"] != other["cam_scale"]
