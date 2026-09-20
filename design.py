from dataclasses import dataclass

@dataclass
class MissionConstraints:
    mass_min: float
    mass_max: float
    fuel_min: float
    fuel_max: float
    life_min: float
    life_max: float
    altitude_min: float
    altitude_max: float
    inclination_min: float
    inclination_max: float
    area_min: float
    area_max: float
    drag_coefficient_min: float
    drag_coefficient_max: float
    isp_min: float
    isp_max: float

@dataclass
class SpacecraftMission:
    mass: float
    fuel: float
    lifespan: float
    target_altitude: float
    target_inclination: float
    cross_section_area: float
    drag_coefficient: float
    isp: float

    def to_dict(self):
        return {
            "mass": self.mass,
            "fuel": self.fuel,
            "lifespan": self.lifespan,
            "target_altitude": self.target_altitude,
            "target_inclination": self.target_inclination,
            "cross_section_area": self.cross_section_area,
            "drag_coefficient": self.drag_coefficient,
            "isp": self.isp
        }

class MissionDesigner:
    def __init__(self, constraints: MissionConstraints):
        self.constraints = constraints
        self._validate_constraints()

    def _validate_constraints(self):
        c = self.constraints
        ranges = {
            "mass": (c.mass_min, c.mass_max),
            "fuel": (c.fuel_min, c.fuel_max),
            "lifespan": (c.life_min, c.life_max),
            "altitude": (c.altitude_min, c.altitude_max),
            "inclination": (c.inclination_min, c.inclination_max),
            "area": (c.area_min, c.area_max),
            "drag_coefficient": (c.drag_coefficient_min, c.drag_coefficient_max),
            "isp": (c.isp_min, c.isp_max)
        }
        for name, (minimum, maximum) in ranges.items():
            if minimum > maximum:
                raise ValueError(f"{name}: minimum cannot be greater than maximum.")

    def validate(self, mission: SpacecraftMission) -> tuple[bool, list[str]]:
        c = self.constraints
        errors = []
        checks = {
            "mass": (mission.mass, c.mass_min, c.mass_max, "Mass outside allowed range."),
            "fuel": (mission.fuel, c.fuel_min, c.fuel_max, "Fuel outside allowed range."),
            "lifespan": (mission.lifespan, c.life_min, c.life_max, "Mission lifespan outside allowed range."),
            "target_altitude": (mission.target_altitude, c.altitude_min, c.altitude_max, "Target altitude outside allowed range."),
            "target_inclination": (mission.target_inclination, c.inclination_min, c.inclination_max, "Target inclination outside allowed range."),
            "cross_section_area": (mission.cross_section_area, c.area_min, c.area_max, "Cross-sectional area outside allowed range."),
            "drag_coefficient": (mission.drag_coefficient, c.drag_coefficient_min, c.drag_coefficient_max, "Drag coefficient outside allowed range."),
            "isp": (mission.isp, c.isp_min, c.isp_max, "Isp outside allowed range.")
        }
        for _, (value, minimum, maximum, message) in checks.items():
            if not minimum <= value <= maximum:
                errors.append(message)
        return len(errors) == 0, errors
