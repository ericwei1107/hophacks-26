/// <reference types="vite/client" />
/// <reference types="vite-plugin-glsl/ext" />

interface ImportMetaEnv {
  readonly VITE_SPACETIMEDB_URI?: string;
  readonly VITE_SPACETIMEDB_NAME?: string;
}
