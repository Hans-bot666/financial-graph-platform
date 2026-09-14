# 用户认证 Phase 1 变更说明

## 1. 变更信息

- 日期：2026-09-10
- 对应规格：`docs/spec/user-management/authentication.spec.md`
- 本次范围：用户名注册、登录、会话恢复、退出和前端路由保护
- 数据存储：FastAPI 后端 SQLite

本文件只记录已实施变更，不是任务拆分文档。

## 2. 实现结果

### 后端

- 新增 SQLite 用户数据库迁移，启用外键、WAL 和 busy timeout。
- 建立用户、identity、密码凭据、角色、权限、会话、登录尝试和审计表。
- 初始化 `platform_admin`、`analyst`、`viewer` 及其权限映射；自助注册用户默认获得 `viewer`。
- 使用 Argon2id 保存密码摘要。
- 实现用户名规范化、保留名、长度及基础弱密码校验。
- 实现注册事务、用户名唯一冲突处理。
- 实现用户名密码登录、账号/IP 失败记录、连续失败锁定。
- 使用 HttpOnly 会话 Cookie 和独立 CSRF Cookie；数据库只保存令牌摘要。
- 实现会话绝对超时、空闲超时、恢复及退出吊销。
- 注册、登录和退出事件写入审计。
- CORS 从任意来源改为配置允许列表，认证写接口增加 Origin 检查。

新增 API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | 获取自助注册及字段规则 |
| POST | `/api/v1/auth/register` | 用户名密码注册 |
| POST | `/api/v1/auth/login` | 登录并建立会话 |
| GET | `/api/v1/auth/me` | 恢复当前用户 |
| POST | `/api/v1/auth/logout` | 校验 CSRF 并吊销当前会话 |

### 前端

- 移除正式认证路径对 Supabase User 和虚构邮箱 `${username}@miaoda.com` 的依赖。
- 重写 `AuthContext`，统一管理当前用户、会话恢复、登录和退出。
- 在应用根节点挂载 `AuthProvider` 和 `RouteGuard`。
- 根业务页面由公开访问改为必须登录。
- 新增 `/login` 和 `/register` 页面。
- 登录前目标地址使用受限 `returnTo` 恢复，阻止协议相对地址跳转。
- 顶部导航增加当前用户昵称及退出入口。
- 登录注册页面复用现有 React、Tailwind、Radix 风格组件和主题变量，采用与现有页面一致的蓝白企业后台视觉。
- 注册页密码与确认密码改为“左侧标签、右侧输入框”的横向表单，两行保留明确的垂直间距。
- 密码输入增加本地“弱 / 中 / 强”三级强度提示和三段进度条，依据长度、大小写、数字及符号综合判断；确认密码即时提示是否一致。

## 3. 现有文件修改

| 文件 | 修改内容 |
| --- | --- |
| `.gitignore` | 忽略 SQLite 数据库、WAL 和 SHM 文件 |
| `.env.example` | 增加用户数据库、注册、会话、Cookie 和 CORS 配置 |
| `docker-compose.yml` | 为后端增加持久化用户数据库卷 |
| `backend/config.py` | 增加 SQLite 和认证配置 |
| `backend/main.py` | 启动时执行用户库迁移，并使用 CORS 允许列表 |
| `backend/requirements.txt` | 增加 `argon2-cffi` |
| `backend/app/api/v1/router.py` | 挂载认证路由 |
| `frontend/src/App.tsx` | 挂载认证上下文和路由保护 |
| `frontend/src/routes.tsx` | 根路由改为受保护并注册登录/注册页 |
| `frontend/src/contexts/AuthContext.tsx` | 从 Supabase 认证改为 FastAPI 会话 |
| `frontend/src/components/common/RouteGuard.tsx` | 同步拦截未登录访问并保留内部返回地址 |
| `frontend/src/components/layouts/TopNav.tsx` | 展示当前用户和退出按钮 |

## 4. 新增文件

| 文件 | 用途 |
| --- | --- |
| `backend/app/core/auth_db.py` | SQLite 连接、迁移、内置角色权限 |
| `backend/app/services/auth_service.py` | 密码、注册、登录、会话和审计服务 |
| `backend/app/api/v1/auth_router.py` | 认证 HTTP API |
| `backend/tests/test_auth.py` | 认证 API 集成测试 |
| `frontend/src/services/auth-api.ts` | 认证 API Client |
| `frontend/src/components/auth/AuthShell.tsx` | 登录注册公共布局 |
| `frontend/src/pages/Login.tsx` | 登录页 |
| `frontend/src/pages/Register.tsx` | 注册页 |

## 5. 配置说明

```dotenv
USER_DB_PATH=/app/data/users.db
SELF_REGISTRATION_ENABLED=true
SESSION_IDLE_MINUTES=30
SESSION_ABSOLUTE_HOURS=12
COOKIE_SECURE=false
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080
```

- 本地 HTTP 开发使用 `COOKIE_SECURE=false`。
- HTTPS 部署必须设置 `COOKIE_SECURE=true`。
- Docker Compose 将 `/app/data` 挂载到命名卷 `backend-user-data`。
- 直接运行后端时，默认数据库为 `backend/data/users.db`。

## 6. 验证

- 后端 `python -m unittest discover -s tests -v`：通过。
- 后端 `python -m compileall -q app main.py config.py`：通过。
- 前端 `pnpm typecheck`：通过。
- 前端 `pnpm lint`：通过。
- 前端 `pnpm build`：通过。

构建仍存在项目原有的大包体提示，不影响本次构建成功。

## 7. 当前边界

- 本次没有实施 `authorization.spec.md`，现有图查询等业务 API 尚未增加 RBAC 依赖；前端业务根页面已经要求登录。
- 本次没有实施个人资料编辑、后台用户管理、邮箱/手机号和找回密码。
- 弱密码检查当前使用本地基础名单；生产上线前应接入经过审核的泄露密码数据源或离线列表。
- 首个 `platform_admin` 的受控初始化命令尚未实现，自助注册不会产生管理员。
- 当前按单个后端写入同一 SQLite 文件设计，不支持多个后端实例共享 SQLite。
