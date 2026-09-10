# 用户资料管理规格

## 1. 信息

- 规格 ID：UM-PROFILE
- 状态：Draft
- 阶段：Phase 1
- 依赖：[认证规格](authentication.spec.md)

## 2. 范围

本规格定义用户查看和维护昵称等个人资料，以及管理员维护目标用户资料。用户名、密码、角色、邮箱和手机号不通过通用资料接口修改。

## 3. 数据契约

```ts
interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  status: 'pending' | 'active' | 'disabled' | 'locked';
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

| 字段 | 本人可修改 | 规则 |
| --- | --- | --- |
| `id` | 否 | UUID，永久稳定 |
| `username` | 否 | 规则见认证规格 |
| `displayName` | 是 | 去除首尾空白后 1–50 字符，允许中文，禁止控制字符 |
| `avatarUrl` | 是 | 可空，只允许 HTTPS 或平台同源相对资源 |
| `bio` | 是 | 可空，最多 500 字符，按纯文本处理 |
| `status` | 否 | 由认证策略或管理员管理 |
| `version` | 否 | 每次修改原子递增 |

## 4. 功能需求

### UM-PROFILE-001 查看本人资料（P0）

拥有 `profile.read.self` 的用户可访问 `/profile` 并调用：

```http
GET /api/v1/users/me
```

响应不得包含密码摘要、会话、内部锁定计数或其他用户信息。无会话返回 `401`。

### UM-PROFILE-002 修改本人资料（P0）

```http
PATCH /api/v1/users/me
X-CSRF-Token: ...

{"displayName":"XIAOMENG","avatarUrl":null,"bio":"软件工程师","version":2}
```

- 只接受 `displayName`、`avatarUrl`、`bio` 和 `version`。
- 提交 `username`、`status`、`roles` 等受保护字段返回 `422`。
- SQLite 使用条件更新 `WHERE id = ? AND version = ?` 实现乐观并发。
- 没有更新行时返回 `409 PROFILE_VERSION_CONFLICT`。
- 更新和审计写入同一事务。
- 成功返回最新资料并更新导航栏摘要。

### UM-PROFILE-003 昵称（P0）

- 导航栏和普通展示优先使用 `displayName`。
- 管理场景同时显示 `@username`，避免昵称重复导致误操作。
- 昵称不是登录标识，不要求唯一。
- 昵称为空或非法时由后端拒绝。

### UM-PROFILE-004 内容安全（P0）

- 昵称和简介按纯文本保存及渲染，不支持 HTML。
- 前端不得用 `dangerouslySetInnerHTML` 渲染资料。
- 后端拒绝控制字符和非法 URL scheme。
- URL 不得包含 username/password authority。
- 图片加载失败显示默认头像。
- 使用 CSP `img-src` 控制头像来源。

### UM-PROFILE-005 头像（P1）

Phase 1 只保存头像 URL，不实现文件上传。后续头像上传需另行定义对象存储、文件类型嗅探、大小、恶意文件扫描、裁剪和旧文件回收。

### UM-PROFILE-006 管理员修改资料（P0）

拥有 `user.update` 的管理员可通过：

```http
PATCH /api/v1/admin/users/{userId}
```

修改目标用户的昵称、头像 URL 和简介。

- 不能修改用户名、状态、角色、密码或联系方式验证状态。
- 使用与本人修改相同的字段校验和版本控制。
- 记录 actor、target、字段列表和结果。
- 不在审计中保存完整简介旧值或带敏感查询参数的 URL。

### UM-PROFILE-007 资料审计（P0）

- 本人修改：`user.profile.updated`。
- 管理员修改：`user.profile.updated_by_admin`。
- 审计记录必须和资料更新处于同一 SQLite 事务。

### UM-PROFILE-008 删除与保留（P1）

Phase 1 不支持物理删除用户。离职或异常账号通过 `disabled` 状态处理，以保留图谱成果归属和审计引用。

## 5. 页面

路径：`/profile`

包含：

1. 头像预览和 URL。
2. 只读用户名。
3. 昵称输入。
4. 简介及字符计数。
5. 保存、取消和未保存离开提示。
6. 账号安全入口。

交互：

- 初始值来自后端 API。
- 取消恢复最近一次服务端成功值。
- 提交期间禁止重复提交。
- 失败时保留输入并显示字段错误。
- 版本冲突提示重新加载，不自动覆盖。

## 6. API

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/api/v1/users/me` | `profile.read.self` |
| PATCH | `/api/v1/users/me` | `profile.update.self` |
| PATCH | `/api/v1/admin/users/{userId}` | `user.update` |

## 7. 测试与完成标准

- 单元：昵称 Unicode 长度、空白、控制字符、简介边界和 URL 校验。
- API：字段白名单、本人/管理员权限和版本冲突。
- SQLite：并发更新只有一个版本成功，资料与审计保持原子性。
- 前端：取消、失败保留输入、导航栏同步和冲突处理。
- 安全：存储型 XSS、`javascript:` URL、带凭据 URL 和日志注入。
- E2E：登录→修改昵称→刷新→导航栏和个人中心显示一致。
