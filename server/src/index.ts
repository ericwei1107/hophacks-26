/**
 * Module entry point. `spacetime publish` looks for this file's default
 * export (the Schema instance); every reducer/procedure re-exported here
 * gets registered on it.
 */
// Only reducer/procedure exports belong at the module's top level — the
// table objects and the `spacetimedb` schema instance from schema.ts are
// NOT valid loose exports (the module host's export scan rejects them:
// "exporting something that is not a spacetime export"), so schema.ts is
// deliberately not re-exported here.
export * from "./reducers";
export * from "./logic";
export * from "./procedures";

import { spacetimedb } from "./schema";
export default spacetimedb;
