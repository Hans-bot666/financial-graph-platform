# 图空间选择规格

## 1. 信息

- 规格 ID：GS-SEL
- 状态：Draft
- 阶段：Phase 1
- 依赖：[总体规格](README.md)、现有探索分析 API、会话认证

## 2. 用户故事

- 分析人员打开探索分析页，能看到平台已登记且可用的图空间列表。
- 分析人员切换「当前分析图」后，后续点查、展开、路径与场景都在该空间执行。
- 平台运维通过配置登记新空间后，无需改前端硬编码即可出现在列表中。
- 未登记或不可用的空间不能被请求直接 `USE`。

## 3. 功能需求

### GS-SEL-001 图空间目录（P0）

后端维护图空间目录。Phase 1 允许来源为：

1. 内置默认项：至少包含环境变量 `NEBULA_SPACE`（默认 `anti_fraud_kg`）对应条目；
2. 额外白名单：环境变量或配置（例如 `NEBULA_SPACE_CATALOG` JSON / 逗号分隔列表）。

每条目录项至少包含：

```ts
interface GraphSpaceSummary {
  /** Nebula Space 名，请求中使用的唯一标识 */
  id: string;
  /** UI 展示名 */
  displayName: string;
  /** 是否允许被选为当前分析图并发起查询 */
  status: 'ready' | 'offline' | 'unknown';
  /** 可选说明 */
  description?: string | null;
  /** 可选统计；Phase 1 可为 null，禁止为凑数做全图 COUNT */
  vertexCount?: number | null;
  edgeCount?: number | null;
}
```

验收：

- `GET /api/v1/graph/spaces` 返回当前用户会话下可见的目录（Phase 1 = 全量白名单）。
- 未登录或无图查询读权限时，按现有 RBAC 拒绝（与其他图 API 一致）。
- 目录中的 `id` 必须是合法 Nebula space 名格式（字母数字下划线等），非法配置项启动或加载时丢弃并记日志，不得进入响应。

### GS-SEL-002 默认空间（P0）

- `NEBULA_SPACE` 仍为进程默认空间。
- 目录响应可标注 `isDefault: true`（或由前端取配置中的默认 id）。
- 前端首次进入探索分析：优先恢复本地上次选择；若无效则选默认空间；若默认也不在目录，则选第一条 `ready`。

### GS-SEL-003 选择与画布隔离（P0）

探索分析页「当前分析图」下拉：

- 选项来自目录 API，不再仅依赖 `builtinGraphInstances()` 硬编码。
- 切换空间时必须：清空画布节点/边、清空上次查询结果、取消与旧空间相关的待展示状态。
- `offline` / 非 `ready` 项可展示但不可选，或可选后禁止发起查询并提示（二选一，实现须统一；推荐不可选）。

验收：

- 切换空间后画布为空，不残留上一空间子图。
- 下拉展示 `displayName`，并可辅以 `id`（如 `百万随机金融图 · random_financial_graph_million`）。

### GS-SEL-004 请求携带 space（P0）

以下 API 的请求体（或统一查询 DTO）增加必填字段 `space: string`：

- `POST /api/v1/graph/vertices/lookup`
- `POST /api/v1/graph/expand`
- `POST /api/v1/graph/paths`
- `POST /api/v1/scenarios/execute`（及等价场景执行入口）
- 其他会执行业务 nGQL 并返回图结果的探索类接口（只读查询若存在，同样适用）

行为：

1. 校验 `space` 属于目录且 `status === 'ready'`（或等价可用态）。
2. 在该请求的执行路径上 `USE <space>` 后再跑受控查询。
3. **不得**在校验失败时静默改用 `NEBULA_SPACE`。
4. Phase 1 若为降低破坏性允许短暂兼容「缺省 space → 默认空间」，必须在 OpenAPI/错误文档中标明为过渡行为，并在同一版本内尽快改为必填；**推荐 Phase 1 直接必填**。

错误码建议：

| 情况 | HTTP | code |
| --- | ---: | --- |
| 缺少 space（若必填） | 422 | `SPACE_REQUIRED` |
| 未登记 | 404 或 403 | `SPACE_NOT_FOUND` / `SPACE_FORBIDDEN` |
| 已登记但不可用 | 409 或 503 | `SPACE_NOT_READY` |
| Nebula USE/查询失败 | 502/503 | 现有图错误映射 |

### GS-SEL-005 连接与会话模型（P0）

当前客户端多为进程级单 session。按请求切换 space 时必须保证：

- 同一时刻并发请求若指向不同 space，不得互相覆盖导致串空间（需锁、按请求借用 session、或短生命周期 session）。
- 请求结束后，不得把全局默认 session 永久留在「上一次请求的 space」而不被后续默认逻辑感知。

验收：连续交替请求 `anti_fraud_kg` 与 `random_financial_graph_million`，结果集 VID 前缀/内容分别符合各自数据，无串读。

### GS-SEL-006 前端 API Client（P0）

- 新增 `listGraphSpaces()`。
- 现有 graph / scenario client 在发请求时附带当前选中的 `space`。
- 空间列表加载失败时展示明确错误，不回退到「假装只有 anti_fraud_kg 且可查」。
- 本地可缓存上次 `space` id（localStorage），但每次进入页面应能刷新目录。

### GS-SEL-007 与数据导入页关系（P1）

- Phase 1 不要求改造整页「数据接入」流水线。
- 若「当前分析图」仍被导入页复用，应以同一目录 API 为准，避免两套列表。
- `ingestion-store` 中硬编码 builtin 可保留为开发占位，但探索分析主路径不得再把它当作唯一来源。

### GS-SEL-008 安全（P0）

- Space 名只来自白名单比对后的精确匹配，禁止字符串拼接进 `USE` 前未经校验。
- 不向客户端暴露 Nebula 账号密码。
- Phase 1 不做 per-space RBAC；任何能调用图查询 API 的角色，看到同一白名单。须在文档中写明，避免被误解为已隔离。

### GS-SEL-009 可观测性（P1）

- 日志/审计（若已有查询审计）记录 `space`、接口、用户 id、结果规模或错误码。
- `/health` 可继续返回默认 space；可选增加「目录数量」类字段，非必须。

## 4. 配置约定（Phase 1 建议）

```bash
# 默认空间（目录必含，且 isDefault）
NEBULA_SPACE=anti_fraud_kg

# 额外可查询空间（示例：逗号分隔）
NEBULA_EXTRA_SPACES=random_financial_graph_million

# 或 JSON 覆盖展示名（若实现选择 JSON 方案）
# NEBULA_SPACE_CATALOG=[{"id":"anti_fraud_kg","displayName":"对公贷款反欺诈图"},{"id":"random_financial_graph_million","displayName":"百万随机金融图"}]
```

未出现在目录中的 Nebula 物理 Space，即使库里存在，API 也不可选、不可查。

## 5. 非目标

- 创建/删除 Nebula Space。
- 图空间级授权矩阵。
- 强制实时精确点边统计。
- 多环境（dev/stage/prod）目录联邦。

## 6. 验收场景

1. **目录可见**  
   配置包含两空间 → 前端下拉两项均可辨识。

2. **切换生效**  
   选 `random_financial_graph_million`，查已知 `million_` 前缀点 → 有结果；切回 `anti_fraud_kg` 查同一 id → 无结果或空图（视数据而定），不得返回百万图邻居。

3. **拒绝未知空间**  
   手工构造请求 `space=not_in_catalog` → 明确错误，Nebula 侧不应出现对该名的成功业务查询。

4. **并发不串空间**（至少单测或手工交替验证）  
   两空间交替查询结果正确。

5. **无 Mock 伪装成功**  
   目录或 Nebula 失败时，前端显示失败态，不展示伪造统计或伪造成功查询。

## 7. 开放问题（评审时拍板）

1. `space` Phase 1 是否直接必填，还是允许缺省回落默认空间一个小版本？
2. 目录用逗号环境变量还是 JSON？
3. `status` Phase 1 是纯配置静态值，还是每次列表时轻量 `USE` 探测？
4. 场景模板是否绑定固定 space，还是完全跟随当前 UI 选择？

建议默认答案（可改）：

1. 直接必填。  
2. 默认空间 + `NEBULA_EXTRA_SPACES` 逗号列表；展示名可用内置映射表。  
3. 静态 `ready`，探测作为 P1。  
4. Phase 1 跟随当前 UI 选择。
