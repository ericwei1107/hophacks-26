"""Compare committed fixtures/*.json against a fresh export in memory.

A raw byte/text diff is not safe here: re-running export_fixtures.py on a
different Python patch version or libm build can change transcendental
results in the last bit or two, with no change to the reference model at
all (observed in practice: values like 237.40006869014277 vs
237.40006869014275, a ~1e-16 relative difference). This script treats
floats with the same kind of tolerance the TS parity tests already apply
(web/src/sim/orbital/__tests__/parity.test.ts uses 1e-12 relative), so it
flags real drift without being flaky across machines.

Everything else -- added/removed/renamed keys, changed strings or bools,
mismatched list lengths -- is still an exact-match failure.

Usage: python scripts/check_fixture_drift.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "fixtures"
REL_TOL = 1e-9
ABS_TOL = 1e-12

sys.path.insert(0, str(REPO_ROOT))
import export_fixtures  # noqa: E402


def diff(path: str, old: object, new: object, errors: list[str]) -> None:
    if isinstance(old, dict) and isinstance(new, dict):
        old_keys, new_keys = set(old), set(new)
        if old_keys != new_keys:
            errors.append(f"{path}: keys differ, committed={sorted(old_keys)} fresh={sorted(new_keys)}")
            return
        for key in sorted(old_keys):
            diff(f"{path}.{key}", old[key], new[key], errors)
    elif isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            errors.append(f"{path}: length differs, committed={len(old)} fresh={len(new)}")
            return
        for index, (old_item, new_item) in enumerate(zip(old, new)):
            diff(f"{path}[{index}]", old_item, new_item, errors)
    elif isinstance(old, (int, float)) and isinstance(new, (int, float)):
        if not math.isclose(old, new, rel_tol=REL_TOL, abs_tol=ABS_TOL):
            errors.append(f"{path}: committed={old!r} fresh={new!r}")
    else:
        if old != new:
            errors.append(f"{path}: committed={old!r} fresh={new!r}")


def main() -> int:
    fresh_exports = {
        "reference_weather.json": export_fixtures.export_weather(),
        "missions.json": export_fixtures.export_missions(),
        "scalar_helpers.json": export_fixtures.export_scalar_helpers(),
        "perturbed_cases.json": export_fixtures.export_perturbed_cases(),
        "corrections.json": export_fixtures.export_corrections(),
    }

    errors: list[str] = []
    for filename, fresh in fresh_exports.items():
        committed_path = FIXTURE_DIR / filename
        if not committed_path.exists():
            errors.append(f"{filename}: missing from fixtures/ (expected by export_fixtures.py)")
            continue
        committed = json.loads(committed_path.read_text())
        diff(filename, committed, fresh, errors)

    if errors:
        print(f"fixture drift detected ({len(errors)} mismatch(es)):")
        for error in errors[:50]:
            print(f"  {error}")
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more")
        print(
            "\nIf this is a real change to design.py / environment.py / "
            "simulate.py, regenerate with 'python export_fixtures.py' and "
            "commit the updated fixtures. If every mismatch is a tiny "
            "float difference, this tolerance (rel_tol=1e-9) should already "
            "absorb it -- see the module docstring before widening it."
        )
        return 1

    print("fixtures match the Python reference model (within tolerance).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
