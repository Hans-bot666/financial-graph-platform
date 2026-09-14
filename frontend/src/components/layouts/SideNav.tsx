import React from 'react';
import {
  Compass,
  Database,
  LayoutDashboard,
  Layers,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { TabKey } from '@/types/index';

interface SideNavProps {
  activeTab: TabKey;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onTabChange: (tab: TabKey) => void;
}

interface NavItem {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '场景看板', icon: LayoutDashboard },
  { key: 'model', label: '模型构建', icon: Layers },
  { key: 'data', label: '数据接入', icon: Database },
  { key: 'explore', label: '探索分析', icon: Compass },
  { key: 'feature', label: '特征工厂', icon: Sparkles },
];

const LogoGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="4" cy="4" r="2" fill="white" opacity="0.95" />
    <circle cx="12" cy="4" r="2" fill="white" opacity="0.95" />
    <circle cx="8" cy="12" r="2" fill="white" opacity="0.95" />
    <path d="M4 4h8M4 4l4 8M12 4l-4 8" stroke="white" strokeWidth="1" opacity="0.65" />
  </svg>
);

const SideNav: React.FC<SideNavProps> = ({
  activeTab,
  collapsed,
  onCollapsedChange,
  onTabChange,
}) => {
  const { hasPermission } = useAuth();

  return (
    // 外层始终只占窄栏宽度；展开面板绝对定位覆盖主界面，不触发布局挤压。
    <aside className="relative z-[60] h-screen w-16 shrink-0">
      <div
        onMouseEnter={() => onCollapsedChange(false)}
        onMouseLeave={() => onCollapsedChange(true)}
        className={cn(
          'absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-border bg-white',
          'transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none',
          collapsed
            ? 'w-16 shadow-none'
            : 'w-52 shadow-[10px_0_28px_-14px_rgba(15,23,42,0.35)]',
        )}
      >
      <div
        className={cn(
          'flex h-16 shrink-0 items-center',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
            <LogoGlyph />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-wide text-foreground">图谱应用平台</div>
              <div className="mt-0.5 truncate text-[7px] tracking-[0.2em] text-muted-foreground">
                GROUP AUDIT INTELLIGENCE
              </div>
            </div>
          )}
        </div>
      </div>

        <nav aria-label="主导航" className={cn('flex-1 space-y-1.5 py-5', collapsed ? 'px-2' : 'px-3')}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onTabChange(item.key)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 w-full items-center rounded-lg text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}

          {hasPermission('user.read') && (
            <button
              type="button"
              onClick={() => onTabChange('admin')}
              title={collapsed ? '用户管理' : undefined}
              aria-label="用户管理"
              aria-current={activeTab === 'admin' ? 'page' : undefined}
              className={cn(
                'mt-4 flex h-10 w-full items-center rounded-lg text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                activeTab === 'admin'
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Users className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">用户管理</span>}
            </button>
          )}
        </nav>
      </div>
    </aside>
  );
};

export default SideNav;
