import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthConfig } from '@/services/auth-api';

function safeReturnTo(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getAuthConfig()
      .then((config) => setRegistrationEnabled(config.selfRegistrationEnabled))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  useEffect(() => {
    if (user) navigate(safeReturnTo(searchParams.get('returnTo')), { replace: true });
  }, [user, navigate, searchParams]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await signIn(identifier, password);
      navigate(safeReturnTo(searchParams.get('returnTo')), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="登录平台" description="使用平台用户名和密码继续">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="identifier">用户名</Label>
          <div className="relative">
            <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="identifier"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="h-10 bg-white pl-9"
              autoComplete="username"
              autoFocus
              required
              maxLength={254}
              placeholder="请输入用户名"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <div className="relative">
            <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 bg-white px-9"
              autoComplete="current-password"
              required
              maxLength={256}
              placeholder="请输入密码"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button className="h-10 w-full" type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? '正在登录' : '登录'}
        </Button>

        {registrationEnabled && (
          <p className="text-center text-sm text-muted-foreground">
            还没有账号？
            <Link className="ml-1 font-medium text-primary hover:underline" to="/register">
              创建账号
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
