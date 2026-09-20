import json
from pathlib import Path


MANIFEST = Path(__file__).resolve().parents[1] / "data" / "emissions_sources.json"
SQL_SEED = Path(__file__).resolve().parents[1] / "sql" / "seeds" / "001_emissions_sources.sql"
REQUIRED_IDS = {
    "barker-marais-mcdowell-2024-global-3d",
    "brown-et-al-2024-worldwide-rocket-emissions",
    "callsen-et-al-2026-reference-engine-emissions",
    "maloney-et-al-2022-rocket-black-carbon",
    "nasa-tm-20240013276-spaceflight-atmosphere",
}


def test_required_emissions_sources_are_retained():
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert {record["source_id"] for record in records} == REQUIRED_IDS
    assert all(record["status"] == "VERIFIED" for record in records)
    assert all(record["retention"] == "REQUIRED" for record in records)
    assert all(record["source_url"].startswith("https://") for record in records)


def test_sql_seed_retains_every_manifest_record():
    seed = SQL_SEED.read_text(encoding="utf-8")
    records = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert "ON CONFLICT (source_id) DO UPDATE" in seed
    for record in records:
        assert record["source_id"] in seed
        assert record["retention"] in seed
