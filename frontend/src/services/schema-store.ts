import type { EdgeType, GraphSchemaDefinition, SchemaVersion, TagType } from '@/types';

const STORAGE_KEY = 'financial-graph-schemas-v1';
export const SCHEMA_STORE_EVENT = 'financial-graph-schemas-changed';

export function createSchema(name = '新建图模型'): GraphSchemaDefinition {
  return {
    id: crypto.randomUUID(), name, description: '', status: 'draft', tags: [], edges: [], versions: [],
    publishedVersionId: null, updatedAt: new Date().toISOString(),
  };
}

export function loadSchemas(fallback?: { name: string; tags: TagType[]; edges: EdgeType[]; versions: SchemaVersion[] }): GraphSchemaDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as GraphSchemaDefinition[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* corrupted local draft falls back to initial model */ }
  if (!fallback) return [];
  return [{
    id: crypto.randomUUID(), name: fallback.name, description: '金融图谱默认模型', status: 'draft',
    tags: fallback.tags, edges: fallback.edges, versions: fallback.versions,
    publishedVersionId: fallback.versions.find((version) => !version.isDraft)?.id ?? null,
    updatedAt: new Date().toISOString(),
  }];
}

export function saveSchemas(schemas: GraphSchemaDefinition[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schemas));
  window.dispatchEvent(new CustomEvent(SCHEMA_STORE_EVENT));
}

export function publishedSchemaVersions(): Array<{ schema: GraphSchemaDefinition; version: SchemaVersion }> {
  return loadSchemas().flatMap((schema) => schema.versions
    .filter((version) => !version.isDraft)
    .map((version) => ({ schema, version })));
}
