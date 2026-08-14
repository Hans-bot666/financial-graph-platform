import MainLayout from './components/layouts/MainLayout';
import NotFound from './pages/NotFound';
import type { ReactNode } from 'react';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  {
    name: '图谱应用平台',
    path: '/',
    element: <MainLayout />,
    public: true,
  },
  {
    name: '404',
    path: '/404',
    element: <NotFound />,
    public: true,
  },
];

