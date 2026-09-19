from dataclasses import dataclass
import random

@dataclass
class MissionConstraints:
    # kg
    mass_min: float
    mass_max: float

    # kg
    fuel_min: float
    fuel_max: float

    # years
    life_min: float
    life_max: float

    # km
    altitude_min: float
    altitude_max: float

    # degrees
    inclination_min: float
    inclination_max: float


@dataclass
class SpacecraftMission:
    mass: float
    fuel: float
    lifespan: float
    target_altitude: float
    target_inclination: float

    def to_dict(self):
        return {
            "mass": self.mass,
            "fuel": self.fuel,
            "lifespan": self.lifespan,
            "target_altitude": self.target_altitude,
            "target_inclination": self.target_inclination,
        }


class MissionDesigner:
    def __init__(self, constraints: MissionConstraints):
        self.constraints = constraints
        self.rng = random.Random()
        self._validate_constraints()

    def _validate_constraints(self):
        c = self.constraints
        ranges = {
            'mass': (c.mass_min, c.mass_max),
            'fuel': (c.fuel_min, c.fuel_max),
            'lifespan': (c.life_min, c.life_max),
            'altitude': (c.altitude_min, c.altitude_max),
            'inclination': (c.inclination_min, c.inclination_max),
        }

        for name, (minimum, maximum) in ranges.items():
            if minimum > maximum:
                raise ValueError(f"{name}: minimum cannot be greater than maximum.")

    def generate_candidate(self) -> SpacecraftMission:
        c = self.constraints
        return SpacecraftMission(
            mass = self.rng.uniform(c.mass_min, c.mass_max),
            fuel = self.rng.uniform(c.fuel_min, c.fuel_max),
            lifespan = self.rng.uniform(c.life_min, c.life_max),
            target_altitude = self.rng.uniform(c.altitude_min, c.altitude_max),
            target_inclination = self.rng.uniform(c.inclination_min, c.inclination_max),
        )

    def validate(self, mission: SpacecraftMission) -> tuple[bool, list[str]]:
        c = self.constraints
        errors = []

        if not c.mass_min <= mission.mass <= c.mass_max:
            errors.append("Mass outside allowed range.")

        if not c.fuel_min <= mission.fuel <= c.fuel_max:
            errors.append("Fuel outside allowed range.")

        if not c.life_min <= mission.lifespan <= c.life_max:
            errors.append("Mission life outside allowed range.")

        if not c.altitude_min <= mission.target_altitude <= c.altitude_max:
            errors.append("Target altitude outside allowed range.")

        if not c.inclination_min <= mission.target_inclination <= c.inclination_max:
            errors.append("Target inclination outside allowed range.")

        return len(errors) == 0, errors

    # generate a valid candidate
    def design(self) -> SpacecraftMission:
        mission = self.generate_candidate()
        valid, errors = self.validate(mission)
        if not valid:
            raise RuntimeError(f"Generated mission is invalid: {errors}")

        return mission

if __name__ == "__main__":
    constraints = MissionConstraints(
        mass_min = 500,
        mass_max = 1000,

        fuel_min = 100,
        fuel_max = 300,

        life_min = 3,
        life_max = 7,

        altitude_min = 400,
        altitude_max = 600,

        inclination_min = 50,
        inclination_max = 100,
    )

    designer = MissionDesigner(constraints)
    mission = designer.design()

    for key, value in mission.to_dict().items():
        print(f"{key}: {value:.2f}")