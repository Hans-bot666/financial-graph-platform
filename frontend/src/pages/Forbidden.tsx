import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <ShieldX className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">没有访问权限</h1>
        <p className="mt-2 text-sm text-muted-foreground">当前账号没有访问此页面的权限，请联系平台管理员。</p>
        <Button asChild className="mt-6">
          <Link to="/">返回首页</Link>
        </Button>
      </div>
    </main>
  );
}
