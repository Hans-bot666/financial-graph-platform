# 用户管理功能规格

## 1. 文档信息

- 状态：Draft
- 版本：0.2.0
- 更新时间：2026-09-10
- 适用范围：金融图谱平台 React 前端、FastAPI 后端、SQLite 用户数据库

本目录只包含规格（Spec），不包含实施任务。是否以及如何拆分 Task，由后续评审决定。

## 2. 规格目录

| 文档 | 内容 | 阶段 |
| --- | --- | --- |
| [authentication.spec.md](authentication.spec.md) | 用户名注册、登录、退出、会话与账号状态 | Phase 1 |
| [authorization.spec.md](authorization.spec.md) | RBAC、接口/页面授权、后台用户管理 | Phase 1 |
| [user-profile.spec.md](user-profile.spec.md) | 昵称、头像和个人资料管理 | Phase 1 |
| [account-recovery.spec.md](account-recovery.spec.md) | 邮箱/手机号登录、验证与找回密码 | Phase 2 |

## 3. 背景

当前前端存在未接入应用根节点的 `AuthContext` 和 `RouteGuard`，用户名登录通过拼接虚拟邮箱调用 Supabase；根路由仍为公开路由。FastAPI 后端没有用户数据库、认证依赖或权限校验。

用户管理不能只在前端实现。前端负责页面、状态和交互提示；密码校验、会话签发、账号状态及最终权限判断必须由 FastAPI 后端执行。

## 4. 目标

1. 支持用户名和密码注册、登录、退出及会话恢复。
2. 支持用户维护昵称等个人资料。
3. 支持管理员查询、创建、启用、禁用、解锁用户及分配角色。
4. 使用 RBAC 同时保护前端页面和后端 API。
5. 使用后端 SQLite 保存用户、凭据摘要、会话、角色和审计数据。
6. 为邮箱、手机号注册登录及找回密码保留扩展能力。

## 5. 范围

### Phase 1

- 用户名/密码注册，可由服务端配置关闭。
- 用户名/密码登录、退出、会话恢复与吊销。
- 昵称、头像 URL、个人简介管理。
- 内置角色及权限校验。
- 管理员用户列表、详情、创建、启停、解锁和角色分配。
- 认证及管理操作审计。

### Phase 2

- 邮箱和手机号绑定、验证及注册。
- 使用已验证邮箱或手机号登录。
- 修改密码和通过已验证渠道找回密码。

### 非目标

- 社交账号、扫码、MFA、SAML/OIDC/LDAP。
- 用户物理删除及数据匿名化。
- 自定义角色编辑器。
- 多租户、部门及图空间级数据范围控制。

## 6. 总体架构

```text
React SPA
  ├─ 登录/注册/个人中心/用户管理
  ├─ AuthProvider：当前用户、角色、权限
  └─ RouteGuard：页面级交互拦截
          │ HTTPS / 同源会话 Cookie
FastAPI /api/v1
  ├─ Auth API：认证、会话、CSRF
  ├─ User API：个人资料与后台用户管理
  ├─ RBAC：API 最终授权
  └─ Audit：身份和权限事件
          │
SQLite：用户、身份、密码摘要、会话、角色、权限、审计

NebulaGraph：仅保存业务图数据，不保存平台用户
```

## 7. SQLite 持久化要求

- 数据库默认路径由 `USER_DB_PATH` 配置，例如 `backend/data/users.db`，不得硬编码绝对路径。
- 数据库文件、`-wal`、`-shm` 和备份文件不得提交 Git。
- 后端是 SQLite 的唯一访问者；浏览器不得直接访问数据库文件。
- 启用外键约束：每个连接执行 `PRAGMA foreign_keys = ON`。
- 启用 WAL：`PRAGMA journal_mode = WAL`，并配置合理的 `busy_timeout`。
- 所有多表写入使用显式事务；用户名注册、角色分配、改密等操作必须原子化。
- 使用迁移机制维护 `schema_version`，禁止仅依赖启动时 `CREATE TABLE IF NOT EXISTS` 演进生产数据。
- 写操作通过短事务完成；不得在事务内发送邮件、短信或执行图查询。
- 生产部署默认只允许单个 FastAPI 服务实例写入同一 SQLite 文件。SQLite 文件不得放在不保证锁语义的共享网络文件系统上。
- 扩展到多实例或高写并发前必须迁移到服务型关系数据库；对外 API 契约不得依赖 SQLite 特性。
- 备份应使用 SQLite Online Backup API 或 `VACUUM INTO`，不能在运行时直接复制活动数据库文件。

## 8. 核心数据模型

| 表 | 关键字段 |
| --- | --- |
| `users` | `id`, `username`, `normalized_username`, `display_name`, `avatar_url`, `bio`, `status`, `auth_version`, `version`, `created_at`, `updated_at` |
| `user_identities` | `id`, `user_id`, `type`, `normalized_value`, `verified_at`, `is_primary` |
| `password_credentials` | `user_id`, `password_hash`, `changed_at` |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `last_seen_at`, `revoked_at` |
| `roles` | `id`, `code`, `name`, `system` |
| `permissions` | `id`, `code`, `name` |
| `user_roles` | `user_id`, `role_id`, `assigned_by`, `assigned_at` |
| `role_permissions` | `role_id`, `permission_id` |
| `verification_challenges` | Phase 2 验证码及找回令牌摘要 |
| `audit_events` | actor、action、target、result、traceId、时间和脱敏元数据 |

- ID 使用 UUID 字符串。
- 时间以 UTC ISO 8601 字符串保存，格式必须固定并可按时间正确排序。
- 唯一性、外键、状态值和版本号必须有数据库约束。
- 密码、会话令牌、验证码和找回令牌只保存不可逆摘要。

## 9. 会话与安全基线

- Web 会话使用 `HttpOnly + Secure + SameSite=Lax` Cookie。
- 会话 ID 在 SQLite 中只保存摘要；登录及提权后轮换。
- 修改状态的请求必须校验 CSRF Token 和 Origin。
- 默认空闲超时 30 分钟，绝对有效期 12 小时。
- 密码使用 Argon2id，不得保存明文或可逆密文。
- 未认证返回 `401`；已认证但无权限返回 `403`。
- 前端隐藏菜单不能代替后端授权。
- 认证、账号状态和角色变更必须写入审计，但不得记录敏感凭据。

## 10. 内置角色

- `platform_admin`：用户和角色分配管理，以及全部平台功能。
- `analyst`：图查询、场景执行、看板读写，管理模块只读。
- `viewer`：查看获授权的平台页面及成果。

权限使用稳定 code，例如：

- `platform.access`
- `profile.read.self`, `profile.update.self`
- `user.read`, `user.create`, `user.update`, `user.status.manage`, `user.role.manage`
- `graph.read`, `graph.query`
- `scenario.read`, `scenario.execute`
- `board.read`, `board.write`
- `schema.read`, `schema.write`
- `ingestion.read`, `ingestion.write`
- `feature.read`, `feature.write`

代码必须按权限 code 判断，不能散落按角色名称判断。

## 11. 统一错误

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "用户名或密码错误",
  "traceId": "01...",
  "details": null
}
```

- 登录和找回接口不得泄露账号是否存在。
- `409` 用于唯一冲突或并发版本冲突。
- `422` 用于字段校验错误。
- `429` 用于登录、短信或邮件频率限制。

## 12. 发布验收

1. Phase 1 的 P0 验收场景全部通过。
2. 未认证、缺权限及绕过前端的请求均被后端阻断。
3. 禁用用户的既有会话最长 60 秒内失效。
4. SQLite、日志和浏览器持久化存储中无明文密码或会话令牌。
5. SQLite 迁移、备份和恢复经过测试。
6. 前端 typecheck、lint、build 及后端单元/集成测试通过。

## 13. 实现前待确认

1. 是否开放自助注册；企业内部部署建议默认关闭。
2. 首个管理员通过受控初始化命令还是部署种子创建。
3. 用户名是否允许中文；本规格默认仅允许 ASCII 字母、数字、点、下划线和短横线。
4. SQLite 数据文件的生产挂载目录、备份周期和保留周期。
5. Phase 2 邮件、短信供应商及验证码合规规则。
