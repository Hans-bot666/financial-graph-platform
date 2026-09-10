# 权限与后台用户管理规格

## 1. 信息

- 规格 ID：UM-AUTHZ
- 状态：Draft
- 阶段：Phase 1
- 依赖：[认证规格](authentication.spec.md)、[资料规格](user-profile.spec.md)

## 2. 权限模型

Phase 1 使用 RBAC：

```text
User --< UserRole >-- Role --< RolePermission >-- Permission
```

- 默认拒绝，没有显式权限即拒绝。
- 后端 API 是最终授权点，前端隐藏入口只改善交互。
- 新用户默认获得 `viewer` 角色。
- 权限判断使用 permission code，不在代码中直接判断角色名称。
- Phase 1 不声称实现租户、机构或图空间级数据隔离。

## 3. 功能需求

### UM-AUTHZ-001 内置角色（P0）

SQLite 迁移必须幂等建立：

- `platform_admin`：拥有全部 Phase 1 权限。
- `analyst`：个人资料、图查询、场景执行、看板读写和其他业务模块只读。
- `viewer`：个人资料及获授权内容的只读访问。

内置角色 code 不可修改或删除。角色和权限映射必须由迁移维护，不能只存在于前端常量。

### UM-AUTHZ-002 后端授权依赖（P0）

FastAPI 必须提供集中式 `require_authenticated_user` 和 `require_permission(code)`。除健康检查及明确公开的认证接口外，所有 `/api/v1` 路由必须声明权限。

验收：

- 无会话返回 `401`。
- 有会话但缺权限返回 `403 AUTHZ_FORBIDDEN`。
- 直接请求 API 绕过前端时结果不变。
- 拒绝事件记录 actor、权限码和 traceId。

### UM-AUTHZ-003 前端能力判断（P0）

- `AuthProvider` 暴露服务端返回的权限集合。
- 提供 `usePermission(code)` 或等价能力。
- 无页面权限时隐藏导航入口，直接访问显示 `/403`。
- 权限加载期间不渲染受控内容。
- 敏感操作即使按钮隐藏，API 仍必须重新授权。

### UM-AUTHZ-004 用户列表（P0）

拥有 `user.read` 的管理员可访问 `/admin/users`：

- 按用户名或昵称查询。
- 按状态、角色筛选。
- 按用户名、创建时间、最后登录时间排序。
- 默认每页 20 条，最大 100 条。
- 返回用户名、昵称、状态、角色、创建时间和最后登录时间。
- 不返回密码摘要、会话令牌、内部失败计数或恢复凭据。

```http
GET /api/v1/admin/users?q=&status=active&role=analyst&page=1&pageSize=20
```

SQLite 查询必须使用参数绑定及排序字段白名单；常用筛选字段必须建立索引。

### UM-AUTHZ-005 管理员创建用户（P0）

拥有 `user.create` 的管理员可创建用户，字段包括用户名、临时密码、昵称、角色和状态。

- 使用单个 SQLite 事务创建用户、凭据和角色。
- 默认状态为 `active`。
- 只有平台管理员可以分配角色。
- 成功返回 `201`，不回显密码。
- 操作写入审计。

### UM-AUTHZ-006 用户状态管理（P0）

允许：

- `active -> disabled`
- `disabled -> active`
- `locked -> active`

```http
PATCH /api/v1/admin/users/{userId}/status

{"status":"disabled","reason":"离职","version":3}
```

- 原因长度 2–500，必填。
- 禁用时原子增加 `authVersion` 并吊销全部会话。
- 管理员不能禁用自己。
- 不能禁用最后一个有效 `platform_admin`。
- 使用 `version` 乐观并发，冲突返回 `409 USER_VERSION_CONFLICT`。

### UM-AUTHZ-007 角色分配（P0）

```http
PUT /api/v1/admin/users/{userId}/roles

{"roleIds":["..."],"version":3}
```

- 用户至少保留一个角色。
- 角色必须存在。
- 管理员不能修改自己的角色。
- 不能移除最后一个有效平台管理员。
- 角色替换、用户版本更新和审计写入必须处于同一 SQLite 事务。
- 成功后使目标用户权限缓存失效。

### UM-AUTHZ-008 角色目录（P0）

`GET /api/v1/admin/roles` 返回可分配角色的 ID、code、名称、说明及权限列表。Phase 1 不提供创建、编辑或删除角色功能。

### UM-AUTHZ-009 用户详情（P0）

拥有 `user.read` 的管理员可以查看用户基本资料、状态、角色、创建/更新时间、最后登录时间及非敏感管理审计摘要。Phase 1 不返回登录 IP 历史和活动会话详情。

### UM-AUTHZ-010 业务权限映射（P0）

| 能力 | 读取 | 修改/执行 |
| --- | --- | --- |
| 图查询 | `graph.read` | `graph.query` |
| 场景 | `scenario.read` | `scenario.execute` |
| 看板 | `board.read` | `board.write` |
| Schema | `schema.read` | `schema.write` |
| 数据接入 | `ingestion.read` | `ingestion.write` |
| 特征 | `feature.read` | `feature.write` |
| 用户 | `user.read` | 对应 `user.*` 权限 |

自由 GQL 同时需要 `graph.query` 并继续受只读查询策略约束。

### UM-AUTHZ-011 对象级越权防护（P0）

所有包含 `{userId}` 的接口必须按路径目标加载并授权，不能信任请求正文中的 ID。管理员资料更新、状态和角色使用服务层独立授权及测试。

### UM-AUTHZ-012 管理审计（P0）

至少记录：

- `user.created`
- `user.profile.updated_by_admin`
- `user.status.changed`
- `user.roles.changed`
- `user.unlocked`
- `authorization.denied`

actor、IP、traceId 和时间由后端生成，调用者不得通过正文覆盖。

### UM-AUTHZ-013 管理员重置其他用户密码（P0）

拥有 `user.password.reset` 的平台管理员可以为其他用户设置新密码。

- 该权限仅授予内置 `platform_admin`。
- 管理员不能通过后台管理接口修改自己的密码。
- 新密码必须通过统一密码策略，接口不得回显密码。
- 请求必须包含 2–500 字符的重置原因和目标用户 `version`。
- 密码更新、`authVersion`/`version` 递增、会话吊销和审计必须在同一 SQLite 事务内完成。
- 成功后目标用户全部既有会话立即失效，旧密码不能再登录。
- 审计事件为 `user.password.reset_by_admin`，只记录操作者、目标用户、原因和结果，不记录密码。

## 4. API

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

分页响应：

```ts
interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
```

## 5. 管理页面

- 路径：`/admin/users`、`/admin/users/:userId`。
- 包含加载、空、错误、无权限和分页状态。
- 筛选条件同步到 URL Query。
- 禁用用户必须填写原因并二次确认。
- 角色和状态冲突时提示刷新，不静默覆盖。
- 成功后使用服务端返回结果更新页面。

## 6. 测试与完成标准

- 每个受保护 API 覆盖匿名、缺权限和有权限。
- 覆盖替换路径 `userId`、正文 ID 注入和版本冲突。
- 覆盖禁止自我禁用/降权及最后管理员保护。
- 覆盖禁用和角色变更后的会话/权限失效。
- SQLite 并发状态更新只能有一个版本成功。
- E2E：管理员创建分析员→分析员可查询图谱但不能管理用户→管理员禁用→分析员会话失效。
