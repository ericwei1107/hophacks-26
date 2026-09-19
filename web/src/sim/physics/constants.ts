/**
 * Shared physical constants. The ascent solver works in meters, kilograms,
 * seconds, and radians; kilometers/tonnes/years/degrees are converted only at
 * explicit boundaries.
 */
export const MU_EARTH = 3.986004418e14; // m^3/s^2
export const EARTH_RADIUS = 6_371_000; // m
export const G0 = 9.80665; // m/s^2
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_YEAR = 365.25;
/** Earth rotation rate, rad/s. */
export const OMEGA_EARTH = 7.2921159e-5;
