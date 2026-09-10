import React, { useEffect, useState } from 'react';
import type { TabKey } from '@/types/index';
import { cn } from '@/lib/utils';
import { getServiceHealth } from '@/services/graph-api';
import { LogOut, UserRound, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface TopNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

interface NavTab {
  key: TabKey;
  label: string;
}

const NAV_TABS: NavTab[] = [
  { key: 'home', label: '首页看板' },
  { key: 'model', label: '模型构建' },
  { key: 'data', label: '数据接入' },
  { key: 'explore', label: '探索分析' },
  { key: 'feature', label: '特征工厂' },
];

const TopNav: React.FC<TopNavProps> = ({ activeTab, onTabChange }) => {
  const { user, signOut, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [connected,setConnected]=useState(false);
  const [space,setSpace]=useState('未连接');
  useEffect(()=>{let live=true;const check=()=>getServiceHealth().then(value=>{if(live){setConnected(value.database==='connected');setSpace(value.space);}}).catch(()=>{if(live){setConnected(false);setSpace('服务不可用');}});void check();const timer=window.setInterval(check,30000);return()=>{live=false;window.clearInterval(timer);};},[]);
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      toast.warning('本地登录状态已清除，但服务端会话吊销未确认');
    }
    navigate('/login', { replace: true });
  };
  return (
    <header className="bg-white border-b border-border sticky top-0 z-50">
      <div className="flex items-center h-12 px-6 gap-8">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="2" fill="white" opacity="0.9" />
              <circle cx="12" cy="4" r="2" fill="white" opacity="0.9" />
              <circle cx="8" cy="12" r="2" fill="white" opacity="0.9" />
              <line x1="4" y1="4" x2="12" y2="4" stroke="white" strokeWidth="1" opacity="0.6" />
              <line x1="4" y1="4" x2="8" y2="12" stroke="white" strokeWidth="1" opacity="0.6" />
              <line x1="12" y1="4" x2="8" y2="12" stroke="white" strokeWidth="1" opacity="0.6" />
            </svg>
          </div>
          <span className="font-semibold text-foreground text-sm tracking-wide">图谱应用平台</span>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-border shrink-0" />

        {/* 导航页签 */}
        <nav className="flex items-center gap-1 flex-1">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'relative px-4 py-2 text-sm font-medium rounded-md transition-all duration-150',
                activeTab === tab.key
                  ? 'text-primary bg-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 右侧状态 */}
        <div className="flex items-center gap-2 shrink-0">
          <div className={`flex items-center gap-1.5 rounded border px-2 py-1 ${connected?'border-green-200 bg-green-50':'border-amber-200 bg-amber-50'}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${connected?'bg-green-500 pulse-dot':'bg-amber-500'}`} />
            <span className={`text-xs font-medium ${connected?'text-green-700':'text-amber-700'}`}>{connected?'已连接':'未连接'}</span>
          </div>
          <span className="text-xs text-muted-foreground">{space}</span>
          {hasPermission('user.read') && (
            <button
              type="button"
              onClick={() => navigate('/admin/users')}
              className="ml-1 flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Users className="h-4 w-4" />
              用户管理
            </button>
          )}
          <div className="mx-1 h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs text-foreground" title={`@${user?.username ?? ''}`}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-primary">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="max-w-24 truncate">{user?.displayName ?? user?.username}</span>
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
