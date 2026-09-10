import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import AuthShell from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAuthConfig, register } from '@/services/auth-api';

type PasswordStrength = {
  level: 0 | 1 | 2 | 3;
  label: '未检测' | '弱' | '中' | '强';
  textClass: string;
  barClass: string;
};

function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { level: 0, label: '未检测', textClass: 'text-muted-foreground', barClass: 'bg-border' };
  }

  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (password.length < 12 || score <= 2) {
    return { level: 1, label: '弱', textClass: 'text-red-600', barClass: 'bg-red-500' };
  }
  if (score <= 4) {
    return { level: 2, label: '中', textClass: 'text-amber-600', barClass: 'bg-amber-500' };
  }
  return { level: 3, label: '强', textClass: 'text-emerald-600', barClass: 'bg-emerald-500' };
}

export default function Register() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const passwordStrength = getPasswordStrength(password);

  useEffect(() => {
    void getAuthConfig()
      .then((config) => setEnabled(config.selfRegistrationEnabled))
      .catch(() => {
        setEnabled(false);
        setError('暂时无法获取注册配置，请稍后重试');
      });
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !enabled) return;
    setError('');
    if (password !== confirmation) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await register({ username, password, displayName });
      toast.success('账号创建成功，请登录');
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="创建平台账号" description="注册后使用用户名登录图谱应用平台">
      {enabled === false ? (
        <div className="space-y-5">
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error || '当前未开放自助注册，请联系平台管理员创建账号。'}
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
            返回登录
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-10 pl-9"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]"
                  placeholder="3-32 位字符"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">昵称</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10"
                required
                maxLength={50}
                placeholder="用于平台内展示"
              />
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3">
              <Label htmlFor="register-password" className="pt-3">密码</Label>
              <div className="space-y-2">
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="register-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-10 px-9"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder="至少 12 个字符"
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
                <div className="flex items-center gap-3" aria-live="polite">
                  <div className="grid flex-1 grid-cols-3 gap-1">
                    {[1, 2, 3].map((level) => (
                      <span
                        key={level}
                        className={`h-1 rounded-full ${
                          passwordStrength.level >= level ? passwordStrength.barClass : 'bg-border'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`min-w-10 text-right text-xs font-medium ${passwordStrength.textClass}`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  建议混合大小写字母、数字和符号，并使用 16 位以上密码。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3">
              <Label htmlFor="password-confirmation" className="pt-3">确认密码</Label>
              <div className="space-y-1.5">
                <Input
                  id="password-confirmation"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="h-10"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  placeholder="再次输入密码"
                  aria-invalid={confirmation.length > 0 && confirmation !== password}
                />
                {confirmation.length > 0 && (
                  <p className={`text-xs ${confirmation === password ? 'text-emerald-600' : 'text-red-600'}`}>
                    {confirmation === password ? '两次密码一致' : '两次输入的密码不一致'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <Button className="h-10 w-full" type="submit" disabled={submitting || enabled === null}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {enabled === null ? '正在加载' : submitting ? '正在创建' : '创建账号'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            已有账号？
            <Link className="ml-1 font-medium text-primary hover:underline" to="/login">
              返回登录
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
