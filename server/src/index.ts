/**
 * Module entry point. `spacetime publish` looks for this file's default
 * export (the Schema instance); every reducer/procedure re-exported here
 * gets registered on it.
 */
export * from "./schema";
export * from "./reducers";
export * from "./logic";
export * from "./procedures";

import { spacetimedb } from "./schema";
export default spacetimedb;
