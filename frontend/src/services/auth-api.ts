export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'pending' | 'active' | 'disabled' | 'locked';
  roles: string[];
  permissions: string[];
}

export interface AuthConfig {
  selfRegistrationEnabled: boolean;
  username: { minLength: number; maxLength: number };
  password: { minLength: number; maxLength: number };
}

interface ApiErrorPayload {
  code?: string;
  message?: string;
  detail?: string;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

const API_BASE_URL = (import.meta.env.VITE_GRAPH_API_BASE_URL ?? '').replace(/\/$/, '');

function csrfToken(): string {
  const item = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('fgp_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null) as ApiErrorPayload | T | null;
  if (!response.ok) {
    const error = payload as ApiErrorPayload | null;
    throw new AuthApiError(
      error?.message ?? error?.detail ?? `认证服务请求失败（HTTP ${response.status}）`,
      error?.code ?? 'AUTH_REQUEST_FAILED',
      response.status,
    );
  }
  return payload as T;
}

export function getAuthConfig(): Promise<AuthConfig> {
  return authRequest<AuthConfig>('/api/v1/auth/config');
}

export function getCurrentUser(): Promise<CurrentUser> {
  return authRequest<CurrentUser>('/api/v1/auth/me');
}

export function login(identifier: string, password: string): Promise<{ user: CurrentUser }> {
  return authRequest<{ user: CurrentUser }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function register(input: {
  username: string;
  password: string;
  displayName: string;
}): Promise<CurrentUser> {
  return authRequest<CurrentUser>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<void> {
  return authRequest<void>('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken() },
  });
}
