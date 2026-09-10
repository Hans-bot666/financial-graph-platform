import type { GraphData } from '@/types/index';

export interface GraphResult extends GraphData {
  title: string;
  columns: string[];
  rows: unknown[][];
  summary: Array<{ key: string; value: string }>;
  warnings: string[];
  traceId: string;
  executionTimeMs: number;
  truncated: boolean;
}

export interface ScenarioParameter {
  name: string;
  label: string;
  type: string;
  required: boolean;
  default: unknown;
}

export interface ScenarioTemplate {
  id: string;
  name: string;
  category: string;
  version: string;
  description: string;
  parameters: ScenarioParameter[];
}

export interface GraphSchemaCatalog {
  entityTypes: string[];
  edgeTypes: string[];
}
export interface ServiceHealth { status:string; database:string; space:string }

const API_BASE_URL = (import.meta.env.VITE_GRAPH_API_BASE_URL ?? '').replace(/\/$/, '');
const QUERY_TIMEOUT_MS = 30_000;

function csrfToken(): string {
  const item = document.cookie.split('; ').find((entry) => entry.startsWith('fgp_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

function apiErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return `图谱服务请求失败（HTTP ${status}）`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const method = init?.method?.toUpperCase() ?? 'GET';
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(method !== 'GET' && method !== 'HEAD' ? { 'X-CSRF-Token': csrfToken() } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(apiErrorMessage(response.status, payload));
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('图谱服务请求超时，请稍后重试');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function listScenarios(): Promise<ScenarioTemplate[]> {
  return requestJson<ScenarioTemplate[]>('/api/v1/scenarios');
}

export function executeScenario(id: string, parameters: Record<string, unknown>): Promise<GraphResult> {
  return requestJson<GraphResult>(`/api/v1/scenarios/${encodeURIComponent(id)}/executions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameters }),
  });
}

export function getGraphSchema(): Promise<GraphSchemaCatalog> {
  return requestJson<GraphSchemaCatalog>('/api/v1/graph/schema');
}
export function getServiceHealth(): Promise<ServiceHealth> { return requestJson<ServiceHealth>('/api/v1/health'); }

export function lookupVertex(input: { value: string; field: 'id' | 'name'; entityType?: string }): Promise<GraphResult> {
  return requestJson<GraphResult>('/api/v1/graph/vertices/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function expandVertex(input: {
  vertexId: string; minHops: number; maxHops: number; edgeTypes: string[]; direction: 'both' | 'out' | 'in';
}): Promise<GraphResult> {
  return requestJson<GraphResult>('/api/v1/graph/expand', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function findPaths(input: {
  startId: string; endId: string; mode: 'shortest' | 'all' | 'any-shortest'; maxHops: number; edgeTypes: string[];
}): Promise<GraphResult> {
  return requestJson<GraphResult>('/api/v1/graph/paths', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export async function executeGraphQuery(query: string): Promise<GraphResult> {
  return requestJson<GraphResult>('/api/v1/graph/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}
