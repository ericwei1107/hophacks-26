"""Fetch orbital-debris rules and evaluate simulated mission compliance.

Federal Register records are informational inputs for the simulator, not legal
advice. The five-year check is an explicit screening rule and should be
reviewed when the mission, orbit, or regulator changes.
"""

from __future__ import annotations

from typing import Any, Iterable

import requests

FEDERAL_REGISTER_URL = "https://www.federalregister.gov/api/v1/documents.json"
DEFAULT_TIMEOUT_SECONDS = 10
DEORBIT_LIMIT_YEARS = 5


def get_latest_debris_rules(
    timeout: int | float = DEFAULT_TIMEOUT_SECONDS,
) -> list[dict[str, str | None]]:
    """Return the five newest FAA orbital-debris documents."""
    params = {
        "conditions[agencies][]": "federal-aviation-administration",
        "conditions[term]": "orbital+debris",
        "order": "newest",
        "per_page": 5,
    }
    response = requests.get(FEDERAL_REGISTER_URL, params=params, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise ValueError("Federal Register returned an unexpected response shape.")

    return [
        {
            "title": _as_optional_string(document.get("title")),
            "publication_date": _as_optional_string(document.get("publication_date")),
            "abstract": _as_optional_string(document.get("abstract")),
            "html_url": _as_optional_string(document.get("html_url")),
        }
        for document in payload["results"]
        if isinstance(document, dict)
    ]


def _as_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def evaluate_mission_compliance(mission: dict[str, Any]) -> dict[str, Any]:
    """Evaluate the five-year post-mission disposal rule."""
    mission_name = str(mission.get("mission_name") or "Unnamed mission")
    decay_years = mission.get("post_mission_decay_years")
    if not isinstance(decay_years, (int, float)) or isinstance(decay_years, bool):
        return {
            "mission_name": mission_name,
            "compliant": False,
            "violations": [
                "post_mission_decay_years must be a numeric value in years."
            ],
        }
    if decay_years > DEORBIT_LIMIT_YEARS:
        return {
            "mission_name": mission_name,
            "compliant": False,
            "violations": [
                f"Post-mission disposal is {decay_years:g} years, exceeding the "
                f"{DEORBIT_LIMIT_YEARS}-year de-orbit limit by "
                f"{decay_years - DEORBIT_LIMIT_YEARS:g} years."
            ],
        }
    return {"mission_name": mission_name, "compliant": True, "violations": []}


def format_for_grok(
    compliance_result: dict[str, Any],
    latest_rules: Iterable[dict[str, Any]],
) -> str:
    """Format compliance data and rule summaries for the Grok voice prompt."""
    status = "COMPLIANT" if compliance_result.get("compliant") else "NOT COMPLIANT"
    lines = [
        "SPACE MISSION REGULATORY BRIEF",
        f"Mission: {compliance_result.get('mission_name', 'Unnamed mission')}",
        f"Compliance status: {status}",
    ]
    violations = compliance_result.get("violations") or []
    lines.append("Violations:")
    lines.extend(f"- {violation}" for violation in violations) if violations else lines.append(
        "- None under the simulator's five-year rule."
    )
    lines.extend(["", "Latest Federal Register orbital-debris references:"])
    rules = list(latest_rules)
    if not rules:
        lines.append("- No matching documents were returned.")
    for index, rule in enumerate(rules, start=1):
        lines.extend(
            [
                f"{index}. {rule.get('title') or 'Untitled document'} "
                f"({rule.get('publication_date') or 'Date unavailable'})",
                f"   Summary: {rule.get('abstract') or 'No abstract available.'}",
                f"   Source: {rule.get('html_url') or 'URL unavailable'}",
            ]
        )
    lines.append(
        "Note: This is a simulator screening rule and not a substitute for "
        "qualified regulatory or legal review."
    )
    return "\n".join(lines)
