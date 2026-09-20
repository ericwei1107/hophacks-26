from fastapi.testclient import TestClient
import pytest

from api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def skip_network_side_effects(monkeypatch):
    monkeypatch.setattr("payload_analysis.get_latest_debris_rules", lambda **_: [])
    monkeypatch.setattr("payload_analysis._safe_footprint", lambda _mission: None)
    monkeypatch.setattr("payload_analysis.briefing_configured", lambda: False)

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
    assert "debris" not in body


def test_analyze_rejects_non_positive_payload_mass():
    bad = dict(HANDOFF, payloadWetMassKg=0)
    response = client.post("/api/analyze", json={"handoff": bad, "runs": 20, "sensitivity_runs": 10})
    assert response.status_code == 422


def test_weather_endpoint_attaches_python_precomputed_effects(monkeypatch):
    live = {
        "weather": {
            "kp": 6.0,
            "f107": 210.0,
            "solar_wind_speed": 720.0,
            "solar_wind_density": 16.0,
            "solar_wind_temperature": 220000.0,
        },
        "source": "noaa",
        "sourceTimestamps": {"kp": "2026-09-20T00:00:00Z"},
        "retrievedAt": "2026-09-20T00:01:00+00:00",
        "freshnessMs": 1000,
    }
    monkeypatch.setattr("payload_analysis.fetch_noaa_snapshot", lambda: live)
    response = client.get("/api/weather")
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "python"
    assert body["effects"]["computedBy"] == "python"
    assert body["effects"]["causes"]
    assert body["effects"]["densityRatioVsReference"] > 1.0
