# 用户认证规格

## 1. 信息

- 规格 ID：UM-AUTH
- 状态：Draft
- 阶段：Phase 1
- 依赖：[总体规格](README.md)

## 2. 用户故事

- 新用户可以使用用户名和密码注册。
- 已激活用户可以安全登录、刷新页面后恢复会话并主动退出。
- 管理员禁用用户后，该用户不能继续访问平台。

## 3. 功能需求

### UM-AUTH-001 注册开关（P0）

后端配置 `SELF_REGISTRATION_ENABLED` 决定是否允许自助注册。前端可读取公开配置决定是否显示入口，但不能决定注册是否被允许。

验收：

- 注册关闭时，注册 API 返回 `403 REGISTRATION_DISABLED`。
- 注册开启时，合法用户创建成功并获得默认 `viewer` 角色。
- 注册接口不能创建管理员。

### UM-AUTH-002 用户名（P0）

- 去除首尾空白并转换为小写规范值。
- 长度 3–32。
- 仅允许字母、数字、`.`、`_`、`-`，首尾必须为字母或数字。
- `admin`、`root`、`system`、`support`、`security`、`api` 等名称保留。
- `normalized_username` 在 SQLite 中使用唯一索引。
- 用户名创建后 Phase 1 不支持修改。

### UM-AUTH-003 密码（P0）

- 长度 12–128 个 Unicode 字符。
- 拒绝与用户名相同、常见弱密码及已知泄露密码。
- 不强制复杂字符组合，允许密码管理器和粘贴。
- FastAPI 后端使用 Argon2id 保存摘要。
- 密码不得进入日志、审计、异常正文或 API 响应。
- 客户端校验只用于交互，后端必须独立校验。

### UM-AUTH-004 注册原子性（P0）

```http
POST /api/v1/auth/register

{"username":"xiaomeng","password":"...","displayName":"小萌"}
```

在一个 SQLite `BEGIN IMMEDIATE` 短事务中创建用户、用户名 identity、密码凭据和默认角色。任一步失败必须回滚，不得残留不完整账号。成功返回 `201` 和不含凭据的用户摘要，默认不自动登录。

SQLite 唯一约束是并发注册冲突的最终判断；应用层预检查不能代替数据库约束。

### UM-AUTH-005 登录（P0）

```http
POST /api/v1/auth/login

{"identifier":"xiaomeng","password":"..."}
```

- Phase 1 将 `identifier` 作为用户名解析，Phase 2 可扩展邮箱和手机号。
- 用户不存在或密码错误统一返回 `401 AUTH_INVALID_CREDENTIALS`。
- `disabled` 用户不得登录；`locked` 用户返回 `423 ACCOUNT_LOCKED` 或统一失败消息。
- 成功后建立服务端会话，设置安全 Cookie，返回当前用户、角色和权限。
- 密码验证完成前不得保持 SQLite 写事务。

### UM-AUTH-006 防暴力破解（P0）

- 按账号规范值和来源 IP 双维度限流。
- 默认连续失败 5 次后锁定 15 分钟。
- 默认同一 IP 每 5 分钟最多 30 次登录尝试。
- 成功登录后清除连续失败计数。
- 计数、锁定和限流由后端执行并审计。
- 频繁写计数不得造成 SQLite 长事务；并发更新必须使用原子 SQL。

### UM-AUTH-007 当前会话（P0）

```http
GET /api/v1/auth/me
```

有效会话返回：

```ts
interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'pending' | 'active' | 'disabled' | 'locked';
  roles: string[];
  permissions: string[];
}
```

会话缺失、过期、被吊销、账号非 active 或 `authVersion` 不一致时返回 `401`。应用启动请求完成前不得渲染受保护内容。

### UM-AUTH-008 退出（P0）

```http
POST /api/v1/auth/logout
X-CSRF-Token: ...
```

后端在 SQLite 中吊销当前会话并清除 Cookie，重复退出保持幂等。前端清空内存中的当前用户并跳转登录页。

### UM-AUTH-009 会话吊销（P0）

- 管理员禁用用户时增加 `authVersion` 并吊销其全部会话。
- 密码重置后吊销全部会话。
- 用户角色变化后权限缓存最长 60 秒内失效。
- 服务端时间是过期判断的唯一依据。
- 过期会话由定时维护命令批量清理，删除需限量执行以避免长时间占用 SQLite 写锁。

### UM-AUTH-010 前端路由（P0）

- `/login` 及按配置启用的 `/register` 为公开页面。
- 其他业务页面默认需要登录。
- 未登录访问时跳转 `/login?returnTo=<内部路径>`。
- `returnTo` 只允许同源且以 `/` 开头的内部路径。
- `401` 跳转登录，`403` 展示无权限页。
- `AuthProvider` 必须挂载在路由外层，`RouteGuard` 使用统一认证状态。
- 正式实现不得继续用 `${username}@miaoda.com` 模拟用户名。

### UM-AUTH-011 审计（P0）

记录注册、登录成功/失败、锁定、解锁、退出、会话吊销及密码变化。事件包括时间、结果、原因码、actor/target、IP、User-Agent 和 traceId，不记录密码、Cookie 或令牌。

## 4. API

| 方法 | 路径 | 认证 | CSRF |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/config` | 否 | 否 |
| POST | `/api/v1/auth/register` | 否 | 否 |
| POST | `/api/v1/auth/login` | 否 | 否 |
| GET | `/api/v1/auth/me` | 是 | 否 |
| POST | `/api/v1/auth/logout` | 是 | 是 |

## 5. 前端状态

```text
unknown --/auth/me 200--> authenticated
unknown --/auth/me 401--> anonymous
anonymous --login 200--> authenticated
authenticated --logout/API 401--> anonymous
authenticated --API 403--> authenticated + forbidden
```

## 6. 测试与完成标准

- 单元：用户名规范化、密码策略、状态机、会话过期和内部跳转校验。
- 集成：注册事务、唯一冲突、Cookie、CSRF、锁定、退出和禁用后的吊销。
- SQLite：外键开启、WAL、busy timeout、并发登录/注册及迁移。
- 前端：无受保护内容闪现，正确区分 401 和 403。
- E2E：注册→登录→刷新→退出；管理员禁用在线用户→旧会话失效。
- 浏览器存储、SQLite 和日志中不存在明文凭据。
