import type { ReactNode } from 'react';
import { ShieldCheck, Waypoints } from 'lucide-react';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export default function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      <header className="h-12 border-b border-border bg-white px-6">
        <div className="flex h-full items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Waypoints className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-foreground">图谱应用平台</span>
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-3rem)] items-center justify-center p-6">
        <section className="grid w-full max-w-[880px] overflow-hidden rounded-lg border border-border bg-white shadow-[0_12px_40px_rgba(30,64,175,0.08)] md:grid-cols-[0.9fr_1.1fr]">
          <div className="relative hidden min-h-[520px] overflow-hidden bg-gradient-to-br from-blue-600 to-blue-500 p-10 text-white md:block">
            <div className="absolute -right-24 -top-20 h-64 w-64 rounded-full border border-white/15" />
            <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full border border-white/10" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-lg bg-white/15">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h1 className="text-2xl font-semibold leading-tight">金融图谱分析工作台</h1>
                <p className="mt-4 text-sm leading-7 text-blue-100">
                  统一管理图谱建模、数据接入、探索分析与特征工程，帮助团队安全、高效地发现关联风险。
                </p>
              </div>
              <div className="space-y-3 text-xs text-blue-100">
                <p className="border-l-2 border-white/50 pl-3">受控访问与会话安全</p>
                <p className="border-l-2 border-white/50 pl-3">统一权限与操作审计</p>
                <p className="border-l-2 border-white/50 pl-3">业务数据与用户数据隔离</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-[520px] items-center px-8 py-10 sm:px-14">
            <div className="w-full">
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
              {children}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
