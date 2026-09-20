from debris import SYNTHETIC_SATCAT
from fastapi.testclient import TestClient
import pytest

from api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def skip_network_side_effects(monkeypatch):
    monkeypatch.setattr("payload_analysis.get_latest_debris_rules", lambda **_: [])
    monkeypatch.setattr("payload_analysis._safe_footprint", lambda _mission: None)
    monkeypatch.setattr("payload_analysis.briefing_configured", lambda: False)
    monkeypatch.setattr("debris.load_satcat", lambda force_refresh=False: list(SYNTHETIC_SATCAT))

HANDOFF = {
    "payloadWetMassKg": 5000,
    "achievedPerigeeKm": 190,
    "achievedApogeeKm": 210,
    "achievedInclinationDeg": 5,
    "stage2PropellantRemainingKg": 800,
    "seed": 7,
    "weather": {
        "source": "reference",
        "weather": {
            "kp": 3,
            "f107": 150,
            "solar_wind_speed": 400,
            "solar_wind_density": 5,
            "solar_wind_temperature": 100000,
        },
    },
}


def test_health_identifies_the_python_backend():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["backend"] == "python"
    assert "emissionsCached" in body
    assert "briefingConfigured" in body


def test_analyze_returns_python_payload_report():
    response = client.post(
        "/api/analyze",
        json={"handoff": HANDOFF, "runs": 20, "sensitivity_runs": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "python"
    assert body["monteCarlo"]["total_runs"] == 20
    assert body["result"]["required_delta_v"] > 0
    assert isinstance(body["insights"], list)
    assert body["debris"] is not None
    assert "cam_scale" in body["debris"]


def test_satcat_returns_shell_census_not_the_catalog():
    response = client.get("/api/satcat", params={"altitude_km": 545})
    assert response.status_code == 200
    body = response.json()
    assert "counts" in body
    assert "cam_scale" in body
    assert "objects" not in body
    assert body["counts"]["total"] > 0


def test_analyze_rejects_non_positive_payload_mass():
    bad = dict(HANDOFF, payloadWetMassKg=0)
    response = client.post("/api/analyze", json={"handoff": bad, "runs": 20, "sensitivity_runs": 10})
    assert response.status_code == 422
