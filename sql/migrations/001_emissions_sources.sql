-- Canonical PostgreSQL storage for the retained emissions-source registry.
CREATE TABLE IF NOT EXISTS emissions_sources (
    source_id TEXT PRIMARY KEY,
    citation TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('VERIFIED', 'UNVERIFIED')),
    source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
    data_url TEXT NOT NULL CHECK (data_url ~ '^https://'),
    data_format TEXT NOT NULL,
    retention TEXT NOT NULL CHECK (retention = 'REQUIRED'),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Required source records are immutable in SQL. Update the manifest and apply
-- a deliberate migration if a record must be superseded.
CREATE OR REPLACE FUNCTION prevent_required_emissions_source_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.retention = 'REQUIRED' THEN
        RAISE EXCEPTION 'cannot delete required emissions source %', OLD.source_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS emissions_sources_prevent_delete ON emissions_sources;
CREATE TRIGGER emissions_sources_prevent_delete
BEFORE DELETE ON emissions_sources
FOR EACH ROW EXECUTE FUNCTION prevent_required_emissions_source_delete();
