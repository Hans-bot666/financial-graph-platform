import MainLayout from './components/layouts/MainLayout';
import AdminUsers from './pages/AdminUsers';
import Forbidden from './pages/Forbidden';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
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
  },
  {
    name: '用户管理',
    path: '/admin/users',
    element: <AdminUsers />,
  },
  {
    name: '登录',
    path: '/login',
    element: <Login />,
    public: true,
  },
  {
    name: '注册',
    path: '/register',
    element: <Register />,
    public: true,
  },
  {
    name: '403',
    path: '/403',
    element: <Forbidden />,
    public: true,
  },
  {
    name: '404',
    path: '/404',
    element: <NotFound />,
    public: true,
  },
];

