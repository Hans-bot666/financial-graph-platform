# 图空间选择规格

## 1. 信息

- 规格 ID：GS-SEL
- 状态：Ready for implementation
- 阶段：Phase 1.1
- 依赖：[总体规格](README.md)、现有探索分析 API、会话认证、NebulaGraph 5.x catalog

## 2. 用户故事

- 分析人员打开探索分析页，能看到图数据库里现有、且未被隐藏的 Graph 列表。
- 运维在 Nebula 中新建 Graph 后，无需改前端硬编码、也无需追加白名单，刷新目录即可看到。
- 运维把不希望暴露的 Graph 写入黑名单后，列表不再显示，查询接口也拒绝。
- 分析人员切换「当前分析图」后，后续点查、展开、路径与场景都在该 Graph 执行。
- 不存在或已隐藏的 Graph 不能被请求直接 `SESSION SET GRAPH`。

## 3. 功能需求

### GS-SEL-001 图空间目录（P0）

后端维护图空间目录。Phase 1.1 来源为：

1. **权威源**：对 NebulaGraph 5.x catalog 执行 `SHOW GRAPHS`（**不得**先 `SESSION SET GRAPH`；列出 Graph 不依赖默认图已存在）。
2. **黑名单**：环境变量 `NEBULA_HIDDEN_GRAPHS`（逗号分隔）。命中项从目录中移除，且不可被查询。
3. **默认标记**：环境变量 `NEBULA_SPACE`（默认 `anti_fraud_kg`）若出现在过滤后的目录中，则 `isDefault: true`。默认图本身不自动「登记进目录」——库里没有就不显示。

每条目录项至少包含：

```ts
interface GraphSpaceSummary {
  /** Nebula Graph 名，请求中使用的唯一标识 */
  id: string;
  /** UI 展示名 */
  displayName: string;
  /** 是否允许被选为当前分析图并发起查询 */
  status: 'ready' | 'offline' | 'unknown';
  /** 可选说明 */
  description?: string | null;
  /** 可选统计；Phase 1.1 可为 null，禁止为凑数做全图 COUNT */
  vertexCount?: number | null;
  edgeCount?: number | null;
  /** 是否为进程默认 Graph（NEBULA_SPACE 且出现在可见目录中） */
  isDefault: boolean;
}
```

展示名：内置映射覆盖已知业务图；未知 id 则用 id 本身。至少覆盖：

- `anti_fraud_kg` → 对公贷款反欺诈图
- `random_financial_graph_million` → 百万随机金融图

验收：

- `GET /api/v1/graph/spaces` 返回过滤后的目录（登录且具备图读权限）。
- 未登录或无图查询读权限时，按现有 RBAC 拒绝（与其他图 API 一致）。
- 目录中的 `id` 必须是合法 Graph 名格式（字母数字下划线）；非法名丢弃并记日志，不得进入响应。
- `SHOW GRAPHS` 失败时 **不得** 返回伪装成功的空目录或白名单兜底；映射为目录不可用错误（建议 HTTP 502，`CATALOG_UNAVAILABLE`）。
- Mock 模式下允许返回内置演示 Graph（至少 `anti_fraud_kg`），并在响应/日志中可区分 Mock，不得把 Mock 目录包装成真实库查询成功。

### GS-SEL-002 默认空间（P0）

- `NEBULA_SPACE` 仍为进程默认 Graph。
- 仅当该 id 出现在可见目录中时标注 `isDefault: true`。
- 前端首次进入：优先恢复本地上次选择；若无效则选默认 Graph；若默认也不在目录，则选第一条 `ready`。

### GS-SEL-003 选择与画布隔离（P0）

探索分析页「当前分析图」下拉：

- 选项来自目录 API，不再仅依赖 `builtinGraphInstances()` 硬编码。
- 切换空间时必须：清空画布节点/边、清空上次查询结果、取消与旧空间相关的待展示状态。
- `offline` / 非 `ready` 项可展示但不可选，或可选后禁止发起查询并提示（实现须统一；推荐不可选）。

验收：

- 切换空间后画布为空，不残留上一空间子图。
- 下拉展示 `displayName`，并可辅以 `id`。

### GS-SEL-004 请求携带 space（P0）

以下 API 的请求体增加必填字段 `space: string`：

- `POST /api/v1/graph/vertices/lookup`
- `POST /api/v1/graph/expand`
- `POST /api/v1/graph/paths`
- `POST /api/v1/scenarios/*/executions`
- `POST /api/v1/graph/query`

行为：

1. 校验 `space` 属于**当前可见目录**且 `status === 'ready'`。
2. 在该请求的执行路径上 `SESSION SET GRAPH <space>` 后再跑受控查询。
3. **不得**在校验失败时静默改用 `NEBULA_SPACE`。
4. 黑名单中的 Graph：即使库中存在，也视为不可查询。

错误码：

| 情况 | HTTP | code |
| --- | ---: | --- |
| 缺少 space | 422 | `SPACE_REQUIRED` |
| 库中不存在 / 格式非法 | 404 | `SPACE_NOT_FOUND` |
| 在黑名单中 | 403 | `SPACE_FORBIDDEN` |
| 已发现但不可用 | 409 | `SPACE_NOT_READY` |
| 目录查询失败 | 502 | `CATALOG_UNAVAILABLE` |
| Nebula 切换/查询失败 | 502/503 | 现有图错误映射 |

### GS-SEL-005 连接与会话模型（P0）

- 列出 Graph 的 catalog 语句不得绑定某个业务 Graph。
- 同一时刻并发请求若指向不同 Graph，不得互相覆盖导致串空间。
- 请求结束后，不得把全局默认 session 永久留在「上一次请求的 Graph」而不被后续默认逻辑感知。

验收：连续交替请求 `anti_fraud_kg` 与 `random_financial_graph_million`，结果集 VID 前缀/内容分别符合各自数据，无串读。

### GS-SEL-006 前端 API Client（P0）

- `listGraphSpaces()` 继续作为唯一目录入口。
- 现有 graph / scenario client 在发请求时附带当前选中的 `space`。
- 空间列表加载失败时展示明确错误，不回退到「假装只有 anti_fraud_kg 且可查」。
- 本地可缓存上次 `space` id，但每次进入页面应刷新目录。

### GS-SEL-007 与数据导入 / 特征工厂关系（P0）

- 探索分析与特征工厂的选图下拉均使用 `GET /api/v1/graph/spaces`。
- `ingestion-store` 中硬编码 builtin 可保留为导入任务占位，但不得作为探索分析 / 特征工厂的唯一来源。
- Phase 1.1 不要求改造整页「数据接入」流水线。

### GS-SEL-008 安全（P0）

- Graph 名只在格式校验 + 可见目录精确匹配后，才拼进 `SESSION SET GRAPH`。
- 黑名单匹配为精确 id，大小写敏感，与 Nebula Graph 名一致。
- 不向客户端暴露 Nebula 账号密码。
- Phase 1.1 不做 per-space RBAC；任何能调用图查询 API 的角色，看到同一过滤后目录。须在文档中写明。

### GS-SEL-009 可观测性（P1）

- 日志记录 `space`、接口、用户 id、结果规模或错误码；黑名单命中记 `SPACE_FORBIDDEN`。
- `/health` 可继续返回默认 Graph；`catalogSize` 为过滤后可见数量。目录失败时不得把健康检查伪装成「已连上且目录完整」。

## 4. 配置约定（Phase 1.1）

```bash
# 默认 Graph（若库中存在且未隐藏，则 isDefault）
NEBULA_SPACE=anti_fraud_kg

# 不展示、不可查询的 Graph（逗号分隔）。留空表示不过滤。
NEBULA_HIDDEN_GRAPHS=
```

`NEBULA_EXTRA_SPACES` 已废弃：即使仍写在 `.env` 中也不再作为目录来源。

未出现在 `SHOW GRAPHS` 结果中的 Graph，API 不可选、不可查。出现在结果中但列入黑名单的 Graph，同样不可选、不可查。

## 5. 非目标

- 创建/删除 Nebula Graph。
- 图空间级授权矩阵。
- 强制实时精确点边统计。
- 多环境目录联邦。
- 用 3.x `SHOW SPACES` 作为 5.x catalog 权威源。

## 6. 验收场景

1. **目录来自库**  
   Nebula 中有 `anti_fraud_kg` 与 `random_financial_graph_million`，黑名单为空 → 前端下拉两项均可辨识，无需配置 `NEBULA_EXTRA_SPACES`。

2. **黑名单生效**  
   `NEBULA_HIDDEN_GRAPHS=random_financial_graph_million` → 下拉无百万图；请求该 space → `403 SPACE_FORBIDDEN`。

3. **切换生效**  
   选百万图，查已知 `million_` 前缀点 → 有结果；切回 `anti_fraud_kg` 查同一 id → 无结果或空图，不得返回百万图邻居。

4. **拒绝未知 Graph**  
   手工构造 `space=not_in_catalog` → `SPACE_NOT_FOUND`，Nebula 侧不应出现对该名的成功业务查询。

5. **并发不串空间**（至少单测或手工交替验证）

6. **无 Mock 伪装成功**  
   `SHOW GRAPHS` 失败时前端显示失败态，不展示伪造目录。

## 7. 开放问题（本期已拍板）

1. `space` 必填，缺省不静默回落。
2. 目录 = `SHOW GRAPHS` − `NEBULA_HIDDEN_GRAPHS`；展示名用内置映射。
3. `status` 对成功发现的 Graph 静态为 `ready`（非法名丢弃，不做每次切换探测）。
4. 场景执行跟随当前 UI 选中的 `space`。
