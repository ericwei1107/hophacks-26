"""Upsert the required emissions-source manifest into SpacetimeDB."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests

MANIFEST = Path(__file__).resolve().parents[1] / "data" / "emissions_sources.json"
REQUIRED_KEYS = {"source_id", "citation", "content", "status", "source_url", "data_url", "data_format", "retention"}


def load_manifest() -> list[dict[str, str]]:
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not isinstance(records, list) or len(records) != 5:
        raise RuntimeError("emissions_sources.json must retain exactly five required records.")
    ids: set[str] = set()
    for record in records:
        if not isinstance(record, dict) or set(record) != REQUIRED_KEYS:
            raise RuntimeError("Each source record must have the canonical schema.")
        if record["source_id"] in ids or record["status"] != "VERIFIED" or record["retention"] != "REQUIRED":
            raise RuntimeError("Source IDs must be unique, VERIFIED, and REQUIRED.")
        ids.add(record["source_id"])
    return records


def ingest(base_url: str, database: str, timeout: int) -> None:
    endpoint = f"{base_url.rstrip('/')}/v1/database/{database}/call/upsert_emissions_source"
    for source in load_manifest():
        payload = [
            source["source_id"], source["citation"], source["content"], source["status"],
            source["source_url"], source["data_url"], source["data_format"], source["retention"],
        ]
        response = requests.post(endpoint, json=payload, timeout=timeout)
        response.raise_for_status()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--database", default="apogee-emissions-sources")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    ingest(args.base_url, args.database, args.timeout)
    print(f"Upserted {len(load_manifest())} REQUIRED emissions-source records into {args.database}.")
