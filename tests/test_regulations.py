import json

import pytest

import regulations


def test_compliance_boundary_is_compliant():
    result = regulations.evaluate_mission_compliance({
        "mission_name": "Boundary mission",
        "post_mission_decay_years": 5,
    })
    assert result["compliant"] is True
    assert result["violations"] == []


def test_compliance_over_limit_has_specific_violation():
    result = regulations.evaluate_mission_compliance({
        "mission_name": "Late disposal",
        "post_mission_decay_years": 5.5,
    })
    assert result["compliant"] is False
    assert "5.5 years" in result["violations"][0]
    assert "5-year de-orbit limit" in result["violations"][0]


def test_compliance_rejects_missing_decay_value():
    result = regulations.evaluate_mission_compliance({"mission_name": "Missing"})
    assert result["compliant"] is False
    assert "numeric value" in result["violations"][0]


def test_fetch_normalizes_federal_register_response(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"results": [{
                "title": "Debris rule",
                "publication_date": "2026-01-01",
                "abstract": "Summary",
                "html_url": "https://example.test/rule",
            }]}

    captured = {}

    def fake_get(url, **kwargs):
        captured.update(url=url, **kwargs)
        return Response()

    monkeypatch.setattr(regulations.requests, "get", fake_get)
    result = regulations.get_latest_debris_rules()
    assert result == [{
        "title": "Debris rule",
        "publication_date": "2026-01-01",
        "abstract": "Summary",
        "html_url": "https://example.test/rule",
    }]
    assert captured["params"]["conditions[agencies][]"] == "federal-aviation-administration"
    assert captured["params"]["conditions[term]"] == "orbital+debris"
    assert captured["params"]["order"] == "newest"
    assert captured["params"]["per_page"] == 5


def test_grok_formatter_includes_status_and_source():
    text = regulations.format_for_grok(
        regulations.evaluate_mission_compliance({"mission_name": "Demo", "post_mission_decay_years": 8}),
        [{"title": "Rule", "publication_date": "2026-01-01", "abstract": "Summary", "html_url": "https://example.test"}],
    )
    assert "NOT COMPLIANT" in text
    assert "https://example.test" in text
    assert "exceeding" in text
