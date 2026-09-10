# 邮箱、手机号与密码找回规格

## 1. 信息

- 规格 ID：UM-RECOVERY
- 状态：Planned
- 阶段：Phase 2
- 依赖：[认证规格](authentication.spec.md)、邮件/短信供应商方案

Phase 1 仅预留数据和 API 扩展点，不展示未接入真实发送与验证能力的入口。

## 2. 原则

- 邮箱和手机号验证后才能用于登录或找回密码。
- 一个规范化邮箱或手机号只能绑定一个用户。
- 发起验证和找回时不得泄露账号是否存在。
- 验证码及找回令牌在 SQLite 中只保存摘要。
- Challenge 短时有效、单次使用并限制尝试次数。
- 改密和找回成功后必须吊销既有会话。

## 3. 标识规范

### 邮箱

- 去除首尾空白。
- 域名转小写并进行 IDNA 规范化。
- 最大长度 254。
- 本地部分大小写和 `+tag` 处理策略必须在实现前固定，不得静默移除。

### 手机号

- 保存为 E.164。
- 未提供国家/地区码时必须由用户选择，后端不猜测。
- 默认掩码展示，例如 `+86 138****1234`。

## 4. 功能需求

### UM-RECOVERY-001 邮箱注册与绑定（P1）

- 自助注册开启时，可使用邮箱、密码和昵称注册。
- 注册后账号可处于 `pending`，邮箱验证成功后变为 `active`。
- 已登录用户绑定或更换邮箱前需近期重新认证。
- 验证链接默认 15 分钟过期，只能使用一次。
- 重复发送时旧 challenge 失效。
- 验证前邮箱不能用于登录或找回密码。

### UM-RECOVERY-002 手机号注册与绑定（P1）

- 自助注册开启时，可使用手机号、密码、昵称和短信验证码注册。
- 验证码为一次性随机值，默认 5 分钟过期，最多尝试 5 次。
- 同手机号 60 秒内最多发送一次，每小时最多 5 次。
- 同时按用户和 IP 限流。
- 短信不得包含密码或其他敏感资料。

### UM-RECOVERY-003 多标识登录（P1）

登录 API 保持稳定：

```json
{"identifier":"user@example.com","password":"..."}
```

后端按明确规则解析用户名、邮箱或手机号，只匹配已验证 identity。不存在、未验证及密码错误均返回 `AUTH_INVALID_CREDENTIALS`。

### UM-RECOVERY-004 发起找回密码（P1）

```http
POST /api/v1/auth/password-recovery

{"identifier":"user@example.com"}
```

- 无论账号或渠道是否存在，均返回 `202` 和相同文案。
- 仅向已验证渠道发送。
- 默认每个 identity 每小时 3 次，每 IP 每小时 10 次。
- 邮箱使用高熵链接令牌；短信使用验证码及服务端恢复事务。
- API 不返回供应商投递结果。

### UM-RECOVERY-005 完成密码重置（P1）

```http
POST /api/v1/auth/password-reset

{"recoveryToken":"...","newPassword":"..."}
```

- 新密码遵循认证规格，并不得等于最近 5 个密码。
- 无效、过期或已使用令牌统一返回 `RECOVERY_TOKEN_INVALID`。
- 在一个 SQLite 事务中更新密码、消费 challenge、增加 `authVersion` 并吊销全部会话。
- 成功后要求重新登录，不自动建立会话。
- 向已验证渠道发送安全通知。

### UM-RECOVERY-006 登录态修改密码（P1）

```http
POST /api/v1/users/me/password

{"currentPassword":"...","newPassword":"..."}
```

- 必须校验当前密码、CSRF 和近期认证。
- 成功后轮换当前会话并吊销其他会话。
- 与密码找回共用密码策略服务。

### UM-RECOVERY-007 更换和解绑联系方式（P1）

- 需要默认 10 分钟内的近期认证。
- 新联系方式验证成功后才替换主要联系方式。
- 唯一恢复渠道解绑前必须先绑定另一已验证渠道，或明确确认失去自助恢复能力。
- 管理员不能直接把未验证渠道标记为已验证。

### UM-RECOVERY-008 恢复安全（P0 for Phase 2）

- 令牌不得进入日志、analytics、Referer 或浏览器持久化存储。
- 找回页面使用 `Referrer-Policy: no-referrer`，加载后从地址栏移除令牌。
- 验证链接域名由服务端固定配置，不接受任意回调 URL。
- 供应商 webhook 必须验签并防重放。
- SQLite challenge 清理采用小批量事务，避免长时间写锁。

## 5. SQLite Challenge 模型

`verification_challenges` 至少包含：

- `id`
- `user_id`，可空，用于尚未完成注册的恢复事务
- `identity_type`
- `normalized_target`
- `purpose`
- `secret_hash`
- `expires_at`
- `consumed_at`
- `attempts`
- `max_attempts`
- `created_at`

必须建立用途、目标和过期时间索引。消费 challenge 使用条件更新确保并发请求只有一次成功。

## 6. API

| 方法 | 路径 | 认证 |
| --- | --- | --- |
| POST | `/api/v1/auth/register/email` | 否 |
| POST | `/api/v1/auth/register/phone/challenges` | 否 |
| POST | `/api/v1/auth/register/phone` | 否 |
| POST | `/api/v1/users/me/email/challenges` | 是 + 近期认证 |
| POST | `/api/v1/users/me/email/verify` | 是 |
| POST | `/api/v1/users/me/phone/challenges` | 是 + 近期认证 |
| POST | `/api/v1/users/me/phone/verify` | 是 |
| POST | `/api/v1/auth/password-recovery` | 否 |
| POST | `/api/v1/auth/password-reset` | 否 |
| POST | `/api/v1/users/me/password` | 是 |

## 7. 页面

- `/settings/security`：联系方式、验证状态、更换、解绑和改密。
- `/forgot-password`：输入任一标识，始终显示统一完成提示。
- `/reset-password`：验证恢复事务后设置新密码。
- OTP 支持粘贴和无障碍标签，但不依赖前端倒计时做安全判断。

## 8. 测试与完成标准

- 邮箱 IDNA、手机号 E.164 和唯一约束。
- 存在/不存在账号的响应状态、正文及时序无明显枚举差异。
- Challenge 过期、重放、错误次数和旧值失效。
- SQLite 并发消费同一 challenge 只能成功一次。
- 找回后全部旧会话失效；登录态改密后只有新当前会话有效。
- URL、Referer、analytics、SQLite 和日志中不存在原始恢复令牌。
- 供应商超时、重复 webhook 和签名错误不会破坏内部状态。

## 9. Phase 2 启动条件

1. 邮件/短信供应商、模板、数据驻留和费用限制评审通过。
2. 邮件域名认证或短信签名备案完成。
3. 找回频率和客服人工恢复流程得到安全及业务确认。
4. Phase 1 的 identity、会话、迁移、备份和审计能力已上线。
