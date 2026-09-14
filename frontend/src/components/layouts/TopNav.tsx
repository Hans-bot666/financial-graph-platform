import React, { useEffect, useState } from 'react';
import type { GraphData, TabKey } from '@/types/index';
import { getServiceHealth } from '@/services/graph-api';
import { LogOut, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import GlobalSearch from './GlobalSearch';

interface TopNavProps {
  activeTab: TabKey;
  onOpenScene: (sceneBoardId: string) => void;
  onOpenSubGraph: (sceneBoardId: string, graphData: GraphData) => void;
}

const TAB_TITLE: Record<TabKey, string> = {
  home: '场景看板',
  model: '模型构建',
  data: '数据接入',
  explore: '探索分析',
  feature: '特征工厂',
  admin: '用户管理',
};

const ROLE_LABELS: Record<string, string> = {
  platform_admin: '平台管理员',
  analyst: '分析员',
  viewer: '查看者',
};

const ROLE_PRIORITY = ['platform_admin', 'analyst', 'viewer'];

const TopNav: React.FC<TopNavProps> = ({ activeTab, onOpenScene, onOpenSubGraph }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let live = true;
    const check = () =>
      getServiceHealth()
        .then((value) => {
          if (live) {
            setConnected(value.database === 'connected');
          }
        })
        .catch(() => {
          if (live) {
            setConnected(false);
          }
        });
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      toast.warning('本地登录状态已清除，但服务端会话吊销未确认');
    }
    navigate('/login', { replace: true });
  };

  const roles = user?.roles ?? [];
  const primaryRole = ROLE_PRIORITY.find((role) => roles.includes(role)) ?? roles[0];
  const primaryRoleLabel = primaryRole ? ROLE_LABELS[primaryRole] ?? primaryRole : '未分配角色';
  const allRoleLabels = roles.map((role) => ROLE_LABELS[role] ?? role).join('、') || '未分配角色';

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white">
      <div className="grid h-12 grid-cols-[minmax(9rem,1fr)_minmax(18rem,36rem)_minmax(18rem,1fr)] items-center gap-4 px-6">
        <div className="min-w-0">
          <div className="truncate text-sm text-muted-foreground">
            工作台
            <span className="mx-1.5 text-border">/</span>
            <span className="font-medium text-foreground">{TAB_TITLE[activeTab]}</span>
          </div>
        </div>

        <div className="flex min-w-0 justify-center">
          <GlobalSearch onOpenScene={onOpenScene} onOpenSubGraph={onOpenSubGraph} />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <div
            className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
              connected ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <div
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500 pulse-dot' : 'bg-amber-500'}`}
            />
            <span
              className={`text-xs font-medium ${connected ? 'text-green-700' : 'text-amber-700'}`}
            >
              {connected ? '已连接' : '未连接'}
            </span>
          </div>
          <div className="mx-1 h-5 w-px bg-border" />
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs text-foreground"
            title={`@${user?.username ?? ''} · ${allRoleLabels}`}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-primary">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block max-w-24 truncate">{user?.displayName ?? user?.username}</span>
              <span className="block max-w-24 truncate text-[10px] text-muted-foreground">{primaryRoleLabel}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="退出登录"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TopNav;
