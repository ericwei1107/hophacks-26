"""Fetch orbital-debris rules and evaluate simulated mission compliance.

The Federal Register documents are informational inputs for the simulator, not
legal advice.  The five-year check below is an explicit simulator rule and
should be reviewed when the mission's orbit, license, or regulator changes.
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
    """Return the five newest FAA orbital-debris documents.

    The Federal Register API is keyless.  Missing abstracts are represented as
    ``None`` because some document records do not provide one.
    """
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

    rules: list[dict[str, str | None]] = []
    for document in payload["results"]:
        if not isinstance(document, dict):
            continue
        rules.append(
            {
                "title": _as_optional_string(document.get("title")),
                "publication_date": _as_optional_string(
                    document.get("publication_date")
                ),
                "abstract": _as_optional_string(document.get("abstract")),
                "html_url": _as_optional_string(document.get("html_url")),
            }
        )

    return rules


def _as_optional_string(value: Any) -> str | None:
    """Normalize API fields while preserving absent values as ``None``."""
    if value is None:
        return None
    return str(value).strip() or None


def evaluate_mission_compliance(mission: dict[str, Any]) -> dict[str, Any]:
    """Evaluate the simulator's five-year post-mission disposal rule.

    Expected input includes ``post_mission_decay_years`` and may include a
    ``mission_name``.  The result is structured for both UI use and prompt
    formatting.
    """
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

    return {
        "mission_name": mission_name,
        "compliant": True,
        "violations": [],
    }


def format_for_grok(
    compliance_result: dict[str, Any],
    latest_rules: Iterable[dict[str, Any]],
) -> str:
    """Format compliance data and rule summaries as a readable voice prompt."""
    status = "COMPLIANT" if compliance_result.get("compliant") else "NOT COMPLIANT"
    lines = [
        "SPACE MISSION REGULATORY BRIEF",
        f"Mission: {compliance_result.get('mission_name', 'Unnamed mission')}",
        f"Compliance status: {status}",
    ]

    violations = compliance_result.get("violations") or []
    if violations:
        lines.append("Violations:")
        lines.extend(f"- {violation}" for violation in violations)
    else:
        lines.append("Violations: None under the simulator's five-year rule.")

    lines.extend(
        [
            "",
            "Latest Federal Register orbital-debris references:",
        ]
    )

    rules = list(latest_rules)
    if not rules:
        lines.append("- No matching documents were returned.")
    else:
        for index, rule in enumerate(rules, start=1):
            title = rule.get("title") or "Untitled document"
            date = rule.get("publication_date") or "Date unavailable"
            abstract = rule.get("abstract") or "No abstract available."
            url = rule.get("html_url") or "URL unavailable"
            lines.extend(
                [
                    f"{index}. {title} ({date})",
                    f"   Summary: {abstract}",
                    f"   Source: {url}",
                ]
            )

    lines.append(
        "Note: This is a simulator screening rule and not a substitute for "
        "qualified regulatory or legal review."
    )
    return "\n".join(lines)


if __name__ == "__main__":
    demo_mission = {
        "mission_name": "Mission A",
        "post_mission_decay_years": 12,
        "fuel_margin_percent": 10,
    }

    compliance = evaluate_mission_compliance(demo_mission)
    try:
        rules = get_latest_debris_rules()
    except requests.RequestException as error:
        print(f"Could not fetch Federal Register rules: {error}")
        rules = []

    print(format_for_grok(compliance, rules))
