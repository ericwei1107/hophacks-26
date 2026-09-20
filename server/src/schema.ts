import { schema, table, t } from "spacetimedb/server";

/** Persisted mirror of data/emissions_sources.json. */
export const emissionsSource = table(
  { name: "emissions_source", public: true },
  {
    sourceId: t.string().primaryKey(),
    citation: t.string(),
    content: t.string(),
    status: t.string(),
    sourceUrl: t.string(),
    dataUrl: t.string(),
    dataFormat: t.string(),
    retention: t.string(),
    ingestedAt: t.timestamp(),
  },
);

export const spacetimedb = schema({ emissionsSource });
