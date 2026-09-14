# 用户权限与后台管理 Phase 1 变更说明

## 1. 变更信息

- 日期：2026-09-10
- 对应规格：`docs/spec/user-management/authorization.spec.md`
- 数据存储：FastAPI 后端 SQLite
- 范围：RBAC、业务 API 授权、用户查询/创建/编辑/启停/解锁/角色管理

本文件记录实际代码变更，不是 Task 文档。

## 2. 后端变更

### 统一认证和权限依赖

- 新增 `require_authenticated_user` 和 `require_permission(code)`。
- 无会话返回 `401`，缺少权限返回 `403 AUTHZ_FORBIDDEN`。
- 权限以服务端返回的 permission code 判断，不依赖前端菜单。
- 写接口同时校验会话、Origin 和 CSRF Token。
- 权限拒绝写入 `authorization.denied` 审计。

### 现有 `/api/v1` 权限映射

| 能力 | 读取权限 | 写入/执行权限 |
| --- | --- | --- |
| 图 Schema、实体定位 | `graph.read` | `graph.query` |
| 图扩展、路径和自由 GQL | - | `graph.query` |
| 场景目录、执行 | `scenario.read` | `scenario.execute` |
| 特征定义 | `feature.read` | `feature.write` |

`/api/v1/health` 和认证公开接口保持公开。旧版 `/api/*` 接口仍属于迁移兼容接口，不在本规格的 `/api/v1` 权限范围内。

### 后台用户 API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/api/v1/admin/users` | `user.read` |
| POST | `/api/v1/admin/users` | `user.create` |
| GET | `/api/v1/admin/users/{userId}` | `user.read` |
| PATCH | `/api/v1/admin/users/{userId}` | `user.update` |
| PATCH | `/api/v1/admin/users/{userId}/status` | `user.status.manage` |
| PUT | `/api/v1/admin/users/{userId}/roles` | `user.role.manage` |
| POST | `/api/v1/admin/users/{userId}/password` | `user.password.reset` |
| GET | `/api/v1/admin/roles` | `user.read` |

实现内容：

- 用户列表支持参数化搜索、状态/角色筛选和分页。
- 创建用户、凭据和角色在同一 SQLite 事务内提交。
- 昵称、头像 URL 和简介使用字段白名单及版本控制。
- 状态和角色更新使用 `version` 乐观并发。
- 禁用用户、解锁用户或修改角色时增加 `authVersion` 并吊销既有会话。
- 禁止管理员修改自己的状态或角色。
- 禁止禁用或移除最后一个有效平台管理员。
- 用户创建、资料、状态和角色变化写入审计。
- 新增仅平台管理员拥有的 `user.password.reset` 权限，可重置其他用户密码。
- 重置密码需填写原因并校验乐观并发版本；成功后旧密码失效、全部目标会话吊销并记录审计。

### 首个平台管理员

新增受控初始化命令：

```powershell
cd backend
python create_admin.py --username platform-admin --display-name 平台管理员
```

命令交互式读取密码且不回显。自动化部署可临时设置 `INITIAL_ADMIN_PASSWORD`，执行后应立即清除该环境变量。

- 已存在有效平台管理员时命令幂等退出。
- 指定用户名已被普通用户占用时拒绝提升，防止预注册账号被意外提权。
- 自助注册仍只产生 `viewer`。

## 3. 前端变更

- 图查询和特征 API Client 现在携带会话 Cookie 及 CSRF Token。
- 新增 `/403` 无权限页面。
- 新增 `/admin/users` 用户管理页面。
- 只有拥有 `user.read` 的用户可以看到顶部“用户管理”入口。
- 页面支持用户名/昵称搜索、状态/角色筛选、分页和刷新。
- 支持管理员新建用户、编辑昵称/头像/简介、启停/解锁用户及分配多个角色。
- 平台管理员可在用户操作区重置其他用户密码；对话框包含密码强度、二次确认和重置原因。
- 禁用和角色操作均有确认流程；角色变化提示目标用户会话失效。
- 筛选条件写入 URL Query，可在刷新后恢复。
- 页面沿用现有蓝白主题、紧凑表格、状态徽标和 Radix 对话框。

## 4. 现有文件修改

| 文件 | 修改 |
| --- | --- |
| `backend/app/api/v1/router.py` | 挂载管理路由并为业务 API 声明权限 |
| `backend/app/services/auth_service.py` | 暴露 CSRF 校验并扩展授权审计上下文 |
| `backend/tests/test_api_v1.py` | 现有 v1 测试使用管理员会话和 CSRF |
| `frontend/src/routes.tsx` | 注册 403 和用户管理路由 |
| `frontend/src/components/layouts/TopNav.tsx` | 按权限显示用户管理入口 |
| `frontend/src/services/graph-api.ts` | 携带 Cookie/CSRF 并解析权限错误 |
| `frontend/src/services/feature-store.ts` | 携带 Cookie/CSRF 并解析权限错误 |

## 5. 新增文件

| 文件 | 用途 |
| --- | --- |
| `backend/app/api/dependencies.py` | FastAPI 认证与权限依赖 |
| `backend/app/api/v1/admin_router.py` | 后台用户和角色 API |
| `backend/app/services/user_admin_service.py` | 用户、状态、角色事务服务 |
| `backend/create_admin.py` | 首管理员初始化命令 |
| `backend/tests/test_admin_api.py` | 认证、越权和管理 API 测试 |
| `frontend/src/services/admin-api.ts` | 用户管理 API Client |
| `frontend/src/pages/AdminUsers.tsx` | 用户管理页面 |
| `frontend/src/pages/Forbidden.tsx` | 403 页面 |

## 6. 安全边界

- 前端隐藏入口不是安全边界，所有管理操作均由 FastAPI 再授权。
- 路径中的 `userId` 是目标用户唯一来源，请求正文不能覆盖。
- SQLite 动态查询只允许固定排序字段，用户输入使用参数绑定。
- 状态、角色和资料变更使用条件更新或事务，避免静默覆盖并发修改。
- 角色变更和账号禁用会吊销目标用户会话。

## 7. 验证

- 后端自动化测试覆盖匿名 401、viewer 403、管理员创建/筛选/禁用、版本冲突和自我保护。
- 全部现有 v1 图谱与特征测试在认证和 CSRF 保护下继续通过。
- 首管理员初始化命令已验证首次创建成功，重复执行不产生第二个管理员。
- 后端共 36 项自动化测试通过，包含管理员重置其他用户密码、旧密码失效、会话吊销和禁止自我重置。
- 前端 typecheck、lint 和生产构建通过。

生产构建仍有项目原有的大包体提示，不影响本阶段构建成功。

## 8. 当前边界

- `/admin/users` 采用列表和对话框完成管理，本阶段未单独实现 `/admin/users/:userId` 详情页。
- 角色为内置只读目录，不提供自定义角色编辑器。
- 多租户、机构、部门和图空间数据范围不在本阶段范围。
- 用户本人资料页面属于下一份 `user-profile.spec.md`。

## 9. 登录状态失效问题修复

用户从 `localhost:5173` 访问页面时，前端原先直接请求
`127.0.0.1:8000`。两者不是同一站点，浏览器不会在 Fetch 请求中发送
`SameSite=Lax` 会话 Cookie，导致登录成功后管理接口仍返回 `401`。

修复内容：

- Vite 开发服务器增加 `/api` 到 `127.0.0.1:8000` 的反向代理。
- 前端 API Client 默认使用同源相对路径，不再默认直连后端地址。
- 开发环境变量 `VITE_GRAPH_API_BASE_URL` 默认留空。
- 生产 Nginx 已有 `/api` 代理，部署行为保持一致。
- 修复用户管理筛选参数对象不稳定导致的重复请求循环。

修复后旧站点 Cookie 不再使用，用户需要重新登录一次。
