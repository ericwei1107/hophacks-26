.PHONY: sync-fixtures check-fixtures

# Regenerate the golden fixtures from the Python reference sim and replay
# them against the TypeScript port. Run this after touching design.py,
# environment.py, or simulate.py. See docs/python-ts-fixture-parity.md.
sync-fixtures:
	python export_fixtures.py
	npm --prefix web test -- parity fixtureShape

# Fail if the committed fixtures are stale relative to the Python source.
# Compares in memory (never overwrites fixtures/) with a float tolerance,
# so a different Python/libm build's last-bit rounding doesn't false-positive.
# See scripts/check_fixture_drift.py and docs/python-ts-fixture-parity.md.
check-fixtures:
	python scripts/check_fixture_drift.py
