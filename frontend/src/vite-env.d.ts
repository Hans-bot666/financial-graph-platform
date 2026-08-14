/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRAPH_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
