import { t } from "spacetimedb/server";
import { spacetimedb } from "./schema";

export const upsert_emissions_source = spacetimedb.reducer(
  {
    sourceId: t.string(),
    citation: t.string(),
    content: t.string(),
    status: t.string(),
    sourceUrl: t.string(),
    dataUrl: t.string(),
    dataFormat: t.string(),
    retention: t.string(),
  },
  (ctx, args) => {
    if (args.status !== "VERIFIED" && args.status !== "UNVERIFIED") {
      throw new Error("status must be VERIFIED or UNVERIFIED.");
    }
    if (args.retention !== "REQUIRED") {
      throw new Error("emissions sources must be marked REQUIRED.");
    }
    const row = { ...args, ingestedAt: ctx.timestamp };
    if (ctx.db.emissionsSource.sourceId.find(args.sourceId) === null) {
      ctx.db.emissionsSource.insert(row);
    } else {
      ctx.db.emissionsSource.sourceId.update(row);
    }
  },
);
