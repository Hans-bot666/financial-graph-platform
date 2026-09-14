# 从已有数据按 Schema 创建新图 — 规格

## 1. 信息

- 规格 ID：GC-DATA
- 状态：Draft
- 阶段：Phase 1
- 依赖：[总体说明](README.md)、[图空间选择](../graph-space/README.md)、[Schema 与接入设计稿](../../schema-and-ingestion-design.md)

## 2. 用户故事

- 作为分析/数仓人员，我已有一批图相关数据（导出文件或结构化点边表），希望选定平台上已发布的 Schema，**创建一张新图**并把数据导进去，然后在探索分析里打开这张图。
- 作为建模人员，我先在模型构建中定义并发布 Schema；之后多次用同一 Schema 版本创建多张图（正式、演练、压测副本）。
- 作为平台，我必须保证：新图使用独立 Space、Schema 版本钉死、导入可校验可审计，浏览器不持有图库凭证。

## 3. 主路径（P0）

```text
已有数据准备
    → 选择已发布 Schema 版本
    → 配置点/边映射与 VID 规则（清洗/转换在此完成）
    → 填写新图名称（及可选 space 名）
    → 抽样预检通过
    → 创建图实例（编排：Space + DDL + 导入）
    → 图实例 ready → 探索分析可选
```

**明确：主功能是「导入已有数据并按 Schema 建新图」，不是「只改分析下拉」。**

## 4. 功能需求

### GC-DATA-001 对象与职责（P0）

平台至少区分：

| 对象 | 职责 |
| --- | --- |
| `SchemaDefinition` + `SchemaVersion` | 模型身份与不可变已发布快照 |
| `GraphInstance` | 一张业务图：展示名、状态、`space` 名、绑定的 `schema_version_id` |
| `DataSource` / 上传数据集 | 已有数据的来源描述（Phase 1 范围见开放问题） |
| `MappingJob` / `IngestionRun` | 映射配置与一次导入执行 |

验收：API/文档中不得把「Schema 模板」与「图实例」当成同一 ID。

### GC-DATA-002 仅已发布 Schema 可用于建图（P0）

- 「创建新图」向导中 Schema 下拉**只列出已发布版本**。
- 草稿不可用于创建图实例或正式导入。
- 选定后持久化 `schema_id + version_id`（及内容哈希若有），禁止存 `latest`。

### GC-DATA-003 创建新图实例（P0）

请求语义（逻辑接口，路径可在实现时定）：

```http
POST /api/v1/graph-instances
{
  "displayName": "对公贷款演练图-202609",
  "spaceName": "corp_loan_drill_202609",   // 可选；默认由后端生成合法名
  "schemaVersionId": "...",
  "mappingJobId": "..."                   // 或同请求内嵌映射
}
```

后端编排必须：

1. 校验 space 名合法且**不在**已占用列表 / 禁止覆盖受保护空间（至少禁止默认覆盖 `anti_fraud_kg`，除非显式高危确认——Phase 1 建议直接禁止写入受保护列表）。
2. `CREATE SPACE`（参数可配置分区等）。
3. 等待 Space 就绪后，按该 `schema_version` 生成并执行 DDL（Tag/Edge/Index）。
4. 按映射导入已有数据。
5. 将图实例状态置为 `ready` 或 `failed`（失败保留错误原因，Space 是否回滚见开放问题）。

验收：

- 成功后 Nebula 中存在该 Space，且 `SHOW TAGS/EDGES` 与版本快照一致。
- 探索分析目录可出现该实例（通过平台图实例 API，而不仅是手工 `NEBULA_EXTRA_SPACES`；过渡期可双写白名单）。

### GC-DATA-004 已有数据导入与映射（P0）

- 用户为每个目标 Tag/Edge 配置：源字段 → Schema 属性、VID（及边的 src/dst VID）。
- 支持必要的类型转换声明（string/int/bool/date 等与 Schema 对齐）。
- 清洗责任在映射与预检：平台提供规则与错误报告，**不假设**源数据已完美。

验收：故意错误类型/空 VID 的样本在预检或 run 报告中可见；不得整批标记成功。

### GC-DATA-005 导入前门禁（P0）

与设计稿对齐，至少包括：

- VID 非空、唯一（抽样或全量策略可配置，Phase 1 至少抽样 + 导入期冲突计数）。
- 必填属性无空值（按 Schema）。
- 属性可转换为目标类型。
- 边端点：目标点已存在，或同任务内点→边顺序保证。
- 预检通过才允许进入正式 `IngestionRun`（或允许“预检警告 + 显式确认”——默认不允许跳过错误阈值）。

### GC-DATA-006 任务可观测（P0）

一次导入至少暴露：

- 状态：`pending | running | succeeded | failed | cancelled`
- 已处理行数、成功行数、失败行数
- 错误样本（截断条数上限）
- 开始/结束时间、触发用户

禁止用前端 Mock 数据伪装 `succeeded`。

### GC-DATA-007 与探索分析衔接（P0）

- `GraphInstance.status === ready` 的项进入图空间/图实例列表 API。
- 分析请求继续携带 `space`（已有 GS-SEL）；`space` 必须对应该实例的 `nebula_space_name`。
- 创建中 / 失败的实例不可选或明确禁用。

### GC-DATA-008 安全（P0）

- DDL 与导入仅后端执行。
- Space 名经白名单字符集校验，禁止注入式拼接。
- 凭据不进浏览器、不进映射配置明文落库（数据源密钥走引用）。
- 写操作需登录 + 既有权限（如 `schema.write` / `ingestion.write` / 新建图权限，实现时与授权表对齐）。

### GC-DATA-009 辅助路径：仅发布 Schema（P1）

允许先建模发布、稍后再导入；但 **空 Schema 发布本身不是主成功标准**。主验收仍以「已有数据进新图」为准。

### GC-DATA-010 从已有 Nebula 图迁出再按 Schema 建新图（P1）

若“已有数据”来自另一 Space 的导出：

- Phase 1 可先支持「导出文件 → 再导入」两段式。
- 直接 Space-to-Space 管道可作为 Phase 2，仍必须经过 Schema 版本与映射，禁止无映射盲拷。

## 5. Phase 1 建议范围（便于落地）

| 包含 | 不包含 |
| --- | --- |
| Schema 已发布版本的引用（可先用内置/API 最小集） | 完整可视化建模器一次到位（可迭代） |
| 文件型已有数据（如 CSV/JSON 点表边表） | Hive/Kafka 全连接器 |
| 一键创建新 Space + DDL + 导入任务 | 任意破坏性 Schema 原地迁移 |
| 图实例列表供分析选择 | 自动全图 COUNT 展示 |

## 6. 验收场景

1. **主路径成功**  
   准备符合/可映射的点边 CSV + 已发布 Schema → 创建新图 → 任务成功 → 探索分析可选 → 按 VID 点查命中。

2. **Schema 草稿不可建图**  
   仅草稿时创建图接口拒绝。

3. **坏数据可见**  
   含错误行的文件预检或 run 失败/部分失败，报告含样本；图实例不为假 ready（或 ready 但带明确质量告警——二选一须在实现前拍板，建议：超过错误阈值则 failed）。

4. **隔离**  
   新图数据不出现在未选择的其它 Space 查询中（沿用 GS-SEL 校验）。

5. **受保护空间**  
   不能通过本功能静默覆盖 `anti_fraud_kg`（Phase 1）。

## 7. 开放问题（写 Task 前拍板）

1. Phase 1「已有数据」形态：仅上传文件，还是也要「登记已有目录/对象存储」？
2. 创建失败时：删除半成品 Space，还是保留并标 `failed` 供排障？
3. 图实例目录是否完全取代 `NEBULA_EXTRA_SPACES`，还是过渡期合并？
4. 是否允许「同一 Schema 版本 + 追加导入」到已有图实例，还是 Phase 1 只做一次性灌入？
5. 权限点：新建图用 `ingestion.write` 还是单独 `graph.instance.create`？

建议默认：

1. 上传 CSV/JSON（点表+边表）。  
2. 失败保留 Space + `failed` + 错误信息（可提供“清理”操作）。  
3. 过渡期：平台图实例 ∪ 环境变量白名单。  
4. Phase 1 以新建灌入为主；追加导入 Phase 1.1。  
5. 单独权限更好；若求快可暂挂 `ingestion.write`。
