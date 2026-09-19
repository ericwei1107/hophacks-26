import pytest

from design import MissionConstraints, MissionDesigner, SpacecraftMission


def make_constraints() -> MissionConstraints:
    return MissionConstraints(
        mass_min=500, mass_max=1000,
        fuel_min=100, fuel_max=300,
        life_min=3, life_max=7,
        altitude_min=400, altitude_max=600,
        inclination_min=50, inclination_max=100,
        area_min=5, area_max=20,
        drag_coefficient_min=1.5, drag_coefficient_max=2.5,
        isp_min=200, isp_max=450,
    )


def test_constraints_accept_valid_ranges():
    MissionDesigner(make_constraints())


def test_constraints_reject_inverted_ranges():
    constraints = make_constraints()
    constraints.mass_min, constraints.mass_max = constraints.mass_max, constraints.mass_min
    with pytest.raises(ValueError, match="mass"):
        MissionDesigner(constraints)


def test_validate_accepts_in_range_mission():
    designer = MissionDesigner(make_constraints())
    mission = SpacecraftMission(
        mass=750, fuel=200, lifespan=5, target_altitude=500,
        target_inclination=51.6, cross_section_area=10,
        drag_coefficient=2.2, isp=325,
    )
    ok, errors = designer.validate(mission)
    assert ok
    assert errors == []


def test_validate_flags_every_out_of_range_field():
    designer = MissionDesigner(make_constraints())
    mission = SpacecraftMission(
        mass=2000, fuel=10, lifespan=20, target_altitude=1000,
        target_inclination=200, cross_section_area=50,
        drag_coefficient=9.0, isp=10,
    )
    ok, errors = designer.validate(mission)
    assert not ok
    assert len(errors) == 8
