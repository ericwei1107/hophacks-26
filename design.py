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
