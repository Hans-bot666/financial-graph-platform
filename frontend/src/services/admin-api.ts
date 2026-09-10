export interface AdminRole {
  id: string;
  code: string;
  name: string;
  permissions: string[];
}

export interface UserRoleSummary {
  id: string;
  code: string;
  name: string;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  status: 'pending' | 'active' | 'disabled' | 'locked';
  version: number;
  roles: UserRoleSummary[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface UserPage {
  items: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
}

const API_BASE_URL = (import.meta.env.VITE_GRAPH_API_BASE_URL ?? '').replace(/\/$/, '');

function csrfToken(): string {
  const item = document.cookie.split('; ').find((entry) => entry.startsWith('fgp_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && method !== 'HEAD' ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as
    | { code?: string; message?: string; detail?: { message?: string } | string }
    | T
    | null;
  if (!response.ok) {
    const error = payload as { message?: string; detail?: { message?: string } | string } | null;
    const detail = typeof error?.detail === 'string' ? error.detail : error?.detail?.message;
    throw new Error(error?.message ?? detail ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export function listUsers(params: {
  q?: string;
  status?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}): Promise<UserPage> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.role) search.set('role', params.role);
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 20));
  return request<UserPage>(`/api/v1/admin/users?${search}`);
}

export function listRoles(): Promise<AdminRole[]> {
  return request<AdminRole[]>('/api/v1/admin/roles');
}

export function createUser(input: {
  username: string;
  password: string;
  displayName: string;
  roleIds: string[];
  status: 'active' | 'disabled';
}): Promise<AdminUser> {
  return request<AdminUser>('/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function changeUserStatus(
  userId: string,
  input: { status: 'active' | 'disabled'; reason: string; version: number },
): Promise<AdminUser> {
  return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function updateUser(
  userId: string,
  input: {
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    version: number;
  },
): Promise<AdminUser> {
  return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function replaceUserRoles(
  userId: string,
  input: { roleIds: string[]; version: number },
): Promise<AdminUser> {
  return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/roles`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function resetUserPassword(
  userId: string,
  input: { newPassword: string; reason: string; version: number },
): Promise<AdminUser> {
  return request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/password`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
