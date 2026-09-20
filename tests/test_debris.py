"""Offline tests for the SATCAT crowding screen."""
from debris import SYNTHETIC_SATCAT, cam_scale_from_counts, shell_census


def test_satcat_crowded_shell_exceeds_reference():
    census = shell_census(SYNTHETIC_SATCAT, 545)
    quiet = shell_census(SYNTHETIC_SATCAT, 400)
    assert census["counts"]["total"] > census["reference_counts"]["total"]
    assert census["counts"]["debris"] > 0
    assert census["cam_scale"] >= quiet["cam_scale"]


def test_cam_scale_is_clipped():
    assert cam_scale_from_counts(200, 100) == 2.0
    assert cam_scale_from_counts(10, 100) == 0.4
