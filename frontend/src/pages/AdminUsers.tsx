import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  Waypoints,
} from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  changeUserStatus,
  createUser,
  listRoles,
  listUsers,
  replaceUserRoles,
  resetUserPassword,
  updateUser,
  type AdminRole,
  type AdminUser,
  type UserPage,
} from '@/services/admin-api';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_LABELS: Record<AdminUser['status'], string> = {
  pending: '待激活',
  active: '已启用',
  disabled: '已禁用',
  locked: '已锁定',
};

function formatTime(value: string | null): string {
  if (!value) return '从未登录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function passwordLevel(password: string): { score: number; label: string; className: string } {
  if (!password) return { score: 0, label: '未检测', className: 'text-muted-foreground' };
  let points = password.length >= 12 ? 1 : 0;
  if (password.length >= 16) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;
  if (password.length < 12 || points <= 2) return { score: 1, label: '弱', className: 'text-red-600' };
  if (points <= 4) return { score: 2, label: '中', className: 'text-amber-600' };
  return { score: 3, label: '强', className: 'text-emerald-600' };
}

export default function AdminUsers() {
  const { user, hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryInput, setQueryInput] = useState(searchParams.get('q') ?? '');
  const [data, setData] = useState<UserPage | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [roleUser, setRoleUser] = useState<AdminUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [statusUser, setStatusUser] = useState<AdminUser | null>(null);

  const filterQuery = searchParams.get('q') ?? '';
  const filterStatus = searchParams.get('status') ?? '';
  const filterRole = searchParams.get('role') ?? '';
  const filterPage = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const filters = useMemo(() => ({
    q: filterQuery,
    status: filterStatus,
    role: filterRole,
    page: filterPage,
  }), [filterQuery, filterStatus, filterRole, filterPage]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [users, roleItems] = await Promise.all([
        listUsers({ ...filters, pageSize: 20 }),
        listRoles(),
      ]);
      setData(users);
      setRoles(roleItems);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (hasPermission('user.read')) void load();
  }, [hasPermission, load]);

  if (!hasPermission('user.read')) return <Navigate to="/403" replace />;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setSearchParams(next);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilter('q', queryInput.trim());
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 h-12 border-b bg-white px-6">
        <div className="flex h-full items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Waypoints className="h-4 w-4 text-white" />
            </span>
            <span className="text-sm font-semibold">图谱应用平台</span>
          </Link>
          <span className="h-5 w-px bg-border" />
          <span className="text-sm font-medium text-foreground">用户管理</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>{user?.displayName}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="icon" className="-ml-2 h-8 w-8">
                <Link to="/" aria-label="返回平台"><ArrowLeft className="h-4 w-4" /></Link>
              </Button>
              <h1 className="text-xl font-semibold">用户管理</h1>
            </div>
            <p className="ml-8 mt-1 text-sm text-muted-foreground">查询平台用户，维护账号状态和角色权限。</p>
          </div>
          {hasPermission('user.create') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> 新建用户
            </Button>
          )}
        </div>

        <section className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <form className="flex min-w-72 flex-1 items-center gap-2" onSubmit={handleSearch}>
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  className="pl-9"
                  placeholder="搜索用户名或昵称"
                />
              </div>
              <Button type="submit" variant="outline">查询</Button>
            </form>
            <select
              value={filters.status}
              onChange={(event) => setFilter('status', event.target.value)}
              className="h-9 rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              aria-label="按状态筛选"
            >
              <option value="">全部状态</option>
              <option value="active">已启用</option>
              <option value="disabled">已禁用</option>
              <option value="locked">已锁定</option>
              <option value="pending">待激活</option>
            </select>
            <select
              value={filters.role}
              onChange={(event) => setFilter('role', event.target.value)}
              className="h-9 rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              aria-label="按角色筛选"
            >
              <option value="">全部角色</option>
              {roles.map((role) => <option key={role.id} value={role.code}>{role.name}</option>)}
            </select>
            <Button variant="ghost" size="icon" onClick={() => void load()} aria-label="刷新">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-red-600">
              <span>{error}</span>
              <Button variant="outline" onClick={() => void load()}>重新加载</Button>
            </div>
          ) : loading ? (
            <div className="flex min-h-64 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在加载用户
            </div>
          ) : !data?.items.length ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-muted-foreground">
              <Users className="mb-3 h-9 w-9 text-border" />
              <span className="text-sm">没有符合条件的用户</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">角色</th>
                    <th className="px-4 py-3">创建时间</th>
                    <th className="px-4 py-3">最后登录</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.displayName}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">@{item.username}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            item.status === 'active'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : item.status === 'locked'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                          }
                        >
                          {STATUS_LABELS[item.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.roles.map((role) => <Badge key={role.id} variant="secondary">{role.name}</Badge>)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatTime(item.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatTime(item.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {hasPermission('user.update') && (
                            <Button variant="ghost" size="sm" onClick={() => setEditUser(item)}>
                              编辑
                            </Button>
                          )}
                          {hasPermission('user.role.manage') && item.id !== user?.id && (
                            <Button variant="ghost" size="sm" onClick={() => setRoleUser(item)}>
                              <UserCog className="h-4 w-4" /> 角色
                            </Button>
                          )}
                          {hasPermission('user.password.reset') && item.id !== user?.id && (
                            <Button variant="ghost" size="sm" onClick={() => setPasswordUser(item)}>
                              <KeyRound className="h-4 w-4" /> 重置密码
                            </Button>
                          )}
                          {hasPermission('user.status.manage') && item.id !== user?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatusUser(item)}
                              className={item.status === 'active' ? 'text-red-600' : 'text-emerald-700'}
                            >
                              {item.status === 'active' ? '禁用' : item.status === 'locked' ? '解锁' : '启用'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.total > 0 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <span>共 {data.total} 个用户，第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={data.page <= 1}
                  onClick={() => setFilter('page', String(data.page - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={data.page * data.pageSize >= data.total}
                  onClick={() => setFilter('page', String(data.page + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>

      <CreateUserDialog
        open={createOpen}
        roles={roles}
        onOpenChange={setCreateOpen}
        onSaved={() => void load()}
      />
      <RoleDialog
        user={roleUser}
        roles={roles}
        onOpenChange={(open) => !open && setRoleUser(null)}
        onSaved={() => void load()}
      />
      <EditUserDialog
        user={editUser}
        onOpenChange={(open) => !open && setEditUser(null)}
        onSaved={() => void load()}
      />
      <ResetPasswordDialog
        user={passwordUser}
        onOpenChange={(open) => !open && setPasswordUser(null)}
        onSaved={() => void load()}
      />
      <StatusDialog
        user={statusUser}
        onOpenChange={(open) => !open && setStatusUser(null)}
        onSaved={() => void load()}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  roles,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  roles: AdminRole[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    roleId: 'role:viewer',
    status: 'active' as 'active' | 'disabled',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createUser({
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        roleIds: [form.roleId],
        status: form.status,
      });
      toast.success('用户创建成功');
      setForm({ username: '', displayName: '', password: '', roleId: 'role:viewer', status: 'active' });
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建用户失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>创建用户名密码账号并分配初始角色。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {error && <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="admin-username">用户名</Label>
              <Input id="admin-username" required minLength={3} maxLength={32} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-display-name">昵称</Label>
              <Input id="admin-display-name" required maxLength={50} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-password">临时密码</Label>
            <Input id="admin-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="admin-role">角色</Label>
              <select id="admin-role" className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-status">状态</Label>
              <select id="admin-status" className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as 'active' | 'disabled' })}>
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}{saving ? '正在创建' : '创建用户'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setAvatarUrl(user?.avatarUrl ?? '');
    setBio(user?.bio ?? '');
  }, [user]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateUser(user.id, {
        displayName,
        avatarUrl: avatarUrl.trim() || null,
        bio: bio.trim() || null,
        version: user.version,
      });
      toast.success('用户资料已更新');
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '资料更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑用户资料</DialogTitle>
          <DialogDescription>@{user?.username} 的用户名、状态和角色需通过专用操作修改。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="edit-display-name">昵称</Label>
            <Input id="edit-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={50} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-avatar-url">头像 URL</Label>
            <Input id="edit-avatar-url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} maxLength={2048} placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-bio">个人简介</Label>
            <textarea
              id="edit-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={500}
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="text-right text-xs text-muted-foreground">{bio.length}/500</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving || !displayName.trim()}>
              {saving && <Loader2 className="animate-spin" />}保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  user,
  roles,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  roles: AdminRole[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(user?.roles.map((role) => role.id) ?? []);
  }, [user]);

  const save = async () => {
    if (!user || selected.length === 0) return;
    setSaving(true);
    try {
      await replaceUserRoles(user.id, { roleIds: selected, version: user.version });
      toast.success('角色已更新，用户现有会话已失效');
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '角色更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分配角色</DialogTitle>
          <DialogDescription>为 {user?.displayName} 选择至少一个角色。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {roles.map((role) => (
            <label key={role.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/30">
              <Checkbox
                checked={selected.includes(role.id)}
                onCheckedChange={(checked) => setSelected((value) => (
                  checked ? [...value, role.id] : value.filter((id) => id !== role.id)
                ))}
              />
              <span>
                <span className="block text-sm font-medium">{role.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{role.permissions.length} 项权限 · {role.code}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving || selected.length === 0} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />}保存角色
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const strength = passwordLevel(password);
  const matches = password.length > 0 && password === confirmation;

  useEffect(() => {
    setPassword('');
    setConfirmation('');
    setReason('');
  }, [user]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !matches || reason.trim().length < 2) return;
    setSaving(true);
    try {
      await resetUserPassword(user.id, {
        newPassword: password,
        reason: reason.trim(),
        version: user.version,
      });
      toast.success('密码已重置，目标用户的全部会话已失效');
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '密码重置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置用户密码</DialogTitle>
          <DialogDescription>
            为 {user?.displayName}（@{user?.username}）设置新密码。完成后该用户需要重新登录。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">新密码</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              placeholder="至少 12 个字符"
            />
            <div className="flex items-center gap-2">
              <div className="grid flex-1 grid-cols-3 gap-1">
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={`h-1 rounded-full ${
                      strength.score >= level
                        ? strength.score === 1 ? 'bg-red-500' : strength.score === 2 ? 'bg-amber-500' : 'bg-emerald-500'
                        : 'bg-border'
                    }`}
                  />
                ))}
              </div>
              <span className={`w-10 text-right text-xs font-medium ${strength.className}`}>{strength.label}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-confirmation">确认新密码</Label>
            <Input
              id="reset-password-confirmation"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-invalid={confirmation.length > 0 && !matches}
            />
            {confirmation.length > 0 && (
              <p className={`text-xs ${matches ? 'text-emerald-600' : 'text-red-600'}`}>
                {matches ? '两次密码一致' : '两次输入的密码不一致'}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-reason">重置原因</Label>
            <Input
              id="reset-password-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={2}
              maxLength={500}
              placeholder="例如：用户忘记密码"
            />
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            重置后目标用户的所有登录会话将立即失效。
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving || !matches || reason.trim().length < 2}>
              {saving && <Loader2 className="animate-spin" />}确认重置
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const targetStatus: 'active' | 'disabled' = user?.status === 'active' ? 'disabled' : 'active';

  useEffect(() => setReason(''), [user]);

  const save = async () => {
    if (!user || reason.trim().length < 2) return;
    setSaving(true);
    try {
      await changeUserStatus(user.id, { status: targetStatus, reason: reason.trim(), version: user.version });
      toast.success(targetStatus === 'disabled' ? '用户已禁用' : '用户已启用');
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '状态更新失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{targetStatus === 'disabled' ? '禁用用户' : user?.status === 'locked' ? '解锁用户' : '启用用户'}</DialogTitle>
          <DialogDescription>
            {targetStatus === 'disabled' ? '禁用后该用户的全部会话将立即失效。' : '用户恢复后可以重新登录平台。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="status-reason">操作原因</Label>
          <Input id="status-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={500} placeholder="请输入 2-500 个字符" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant={targetStatus === 'disabled' ? 'destructive' : 'default'} disabled={saving || reason.trim().length < 2} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />}确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
