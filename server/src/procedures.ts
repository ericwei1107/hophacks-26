/**
 * Live external-data sync — the direct TypeScript port of
 * regulations.py::get_latest_debris_rules, run server-side via a
 * SpacetimeDB procedure instead of the browser, so the module (not every
 * client) owns the outbound call and the resulting cache.
 *
 * Procedures don't get `ctx.db` directly (unlike reducers); database
 * writes go through `ctx.withTx`, matching the pattern SpacetimeDB expects
 * for anything that mixes I/O (here: `ctx.http.fetch`) with persistence.
 */
import { t } from "spacetimedb/server";
import { spacetimedb } from "./schema";

const FEDERAL_REGISTER_URL = "https://www.federalregister.gov/api/v1/documents.json";

interface FederalRegisterDocument {
  title?: string | null;
  publication_date?: string | null;
  abstract?: string | null;
  html_url?: string | null;
}

interface FederalRegisterResponse {
  results?: FederalRegisterDocument[];
}

export const sync_debris_rules = spacetimedb.procedure(t.u32(), (ctx) => {
  const query = [
    "conditions[agencies][]=federal-aviation-administration",
    "conditions[term]=orbital+debris",
    "order=newest",
    "per_page=5",
  ].join("&");

  const response = ctx.http.fetch(`${FEDERAL_REGISTER_URL}?${query}`);
  if (!response.ok) {
    throw new Error(`Federal Register request failed: HTTP ${response.status}`);
  }

  const payload = response.json() as FederalRegisterResponse;
  const documents = Array.isArray(payload.results) ? payload.results : [];

  let syncedCount = 0;
  ctx.withTx((tx) => {
    for (const doc of documents) {
      const htmlUrl = doc.html_url?.trim();
      if (!htmlUrl) {
        continue;
      }
      const row = {
        htmlUrl,
        title: doc.title?.trim() || "Untitled document",
        publicationDate: doc.publication_date?.trim() || "",
        abstract: doc.abstract?.trim() || "",
        syncedAt: tx.timestamp,
      };
      if (tx.db.debrisRegulation.htmlUrl.find(htmlUrl) !== null) {
        tx.db.debrisRegulation.htmlUrl.update(row);
      } else {
        tx.db.debrisRegulation.insert(row);
      }
      syncedCount += 1;
    }
  });

  return syncedCount;
});
