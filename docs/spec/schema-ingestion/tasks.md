# 基于 Schema 从已有数据创建图 — 实施任务

## 1. 文档信息

- 状态：Ready for implementation
- 版本：0.1.0
- 更新时间：2026-09-14
- 依据：
  - [总体规格](README.md)
  - [Schema 生命周期](schema-lifecycle.spec.md)
  - [从已有数据创建新图](create-graph-from-data.spec.md)

## 2. Phase 1 MVP 决策

为避免实施阶段反复分叉，本任务清单采用以下默认决策：

| 议题 | Phase 1 决策 |
| --- | --- |
| 已有数据来源 | 先支持上传 CSV；JSON 延后到 Phase 1.1 |
| 文件组织 | 一个文件对应一个目标 Tag 或 Edge；一次建图可包含多个文件 |
| 任务执行 | 建图和导入必须异步；预检可同步执行小样本 |
| 失败后的 Space | 保留并标记 `failed`，不进入分析目录；由显式清理操作删除 |
| 图目录权威 | SQLite 图实例目录为权威，和环境变量白名单合并兼容 |
| 追加导入 | Phase 1 只支持创建新图并首次灌入；不向 ready 图追加 |
| 权限 | 复用 `schema.read/schema.write`、`ingestion.read/ingestion.write` |
| 错误阈值 | P0 默认零容忍；存在预检错误则不能开始建图 |
| 元数据库 | 继续使用后端 SQLite，与用户库文件分表或独立数据库均可 |

## 3. 交付阶段

```text
M1 元数据与 Schema API
   SI-T01 → SI-T02 → SI-T03 → SI-T04

M2 数据上传、映射与预检
   SI-T05 → SI-T06 → SI-T07

M3 异步建图与目录闭环
   SI-T08 → SI-T09 → SI-T10 → SI-T11

M4 前端主流程
   SI-T12 → SI-T13 → SI-T14

M5 测试、文档与验收
   SI-T15 → SI-T16 → SI-T17
```

M1–M3 完成后后端主链路可用；M4 完成后用户可通过 UI 完成整条流程。

## 4. 任务总览

| ID | 任务 | 优先级 | 依赖 | 规模 |
| --- | --- | --- | --- | --- |
| SI-T01 | SQLite 元数据模型与迁移 | P0 | — | M |
| SI-T02 | Schema 定义 CRUD API | P0 | T01 | M |
| SI-T03 | Schema 校验与 DDL 编译器 | P0 | T02 | L |
| SI-T04 | Schema 发布与不可变版本 API | P0 | T03 | M |
| SI-T05 | CSV 数据集上传与样本预览 | P0 | T01 | M |
| SI-T06 | 点边映射模型与 API | P0 | T04,T05 | L |
| SI-T07 | 导入预检引擎与报告 API | P0 | T06 | L |
| SI-T08 | 图实例创建意图与状态机 | P0 | T01,T04,T07 | M |
| SI-T09 | Nebula 建 Space 与应用 Schema | P0 | T03,T08 | L |
| SI-T10 | CSV 流式写点、写边与对账 | P0 | T07,T09 | XL |
| SI-T11 | 图实例目录接入探索分析 | P0 | T08,T10 | M |
| SI-T12 | 前端 Schema API 化 | P0 | T02–T04 | L |
| SI-T13 | 前端上传、映射和预检向导 | P0 | T05–T07,T12 | XL |
| SI-T14 | 前端创建图、任务进度和结果页 | P0 | T08–T11,T13 | L |
| SI-T15 | 后端单元/集成/失败恢复测试 | P0 | T01–T11 | XL |
| SI-T16 | 前端类型检查与关键交互测试 | P0 | T12–T14 | M |
| SI-T17 | 操作指南、变更记录与端到端验收 | P0 | T15,T16 | M |

---

## 5. M1：元数据与 Schema API

### SI-T01 SQLite 元数据模型与迁移

**目标**

建立服务端权威元数据，替代 Schema、映射和图实例的 `localStorage` 真源。

**至少新增**

- `schema_definitions`
- `schema_versions`
- `uploaded_datasets`
- `dataset_files`
- `mapping_definitions`
- `mapping_targets`
- `ingestion_runs`
- `ingestion_errors`
- `graph_instances`

**关键约束**

- Schema 名称和图实例 `space_name` 唯一。
- `schema_versions` 保存完整 JSON 快照与内容哈希。
- 已发布版本不可更新或删除。
- `graph_instances` 必须固定 `schema_definition_id + schema_version_id`。
- 状态字段使用受控值，不保存任意字符串。
- 时间统一 UTC ISO 8601。

**验收**

- 新数据库可自动初始化。
- 重复初始化幂等。
- 唯一约束和外键约束有测试。
- 不修改现有用户认证数据语义。

### SI-T02 Schema 定义 CRUD API

**目标**

让模型构建页从 FastAPI 读写草稿，不再只存浏览器。

**API 建议**

- `GET /api/v1/schemas`
- `POST /api/v1/schemas`
- `GET /api/v1/schemas/{schemaId}`
- `PUT /api/v1/schemas/{schemaId}/draft`
- `DELETE /api/v1/schemas/{schemaId}`（仅无发布版本且未被引用时）

**权限**

- 列表/详情：`schema.read`
- 创建/编辑/删除：`schema.write` + CSRF

**验收**

- 草稿保存后换浏览器仍可恢复。
- 后端独立校验名称、属性和请求大小。
- 被图实例/映射引用的定义不可物理删除。

### SI-T03 Schema 校验与 DDL 编译器

**目标**

将平台 Schema 快照安全、确定性地编译成目标 Space 可执行的 Nebula DDL。

**校验规则**

- Tag/Edge/属性名称合法且不重复。
- 属性类型属于平台映射表。
- 每个点类型具有 VID/主键策略。
- Edge 起点与终点 Tag 存在。
- 默认值与属性类型兼容。
- 索引仅引用存在且可索引的属性。

**编译要求**

- 编译器输出 DDL 列表，不拼入未经校验的标识符。
- DDL 不包含固定 `USE anti_fraud_kg`。
- 同一快照编译结果稳定，内容哈希一致。
- 支持当前最小类型集：
  `string/int/int64/float/double/bool/date/datetime/timestamp`。

**API 建议**

- `POST /api/v1/schemas/{schemaId}/validate`
- 可选：`POST /api/v1/schemas/{schemaId}/compile-preview`

**验收**

- 非法名称、重复字段、坏端点、坏类型均被拒绝。
- 当前 `backend/schema.ngql` 可被等价表达为平台快照。
- 编译结果有快照测试。

### SI-T04 Schema 发布与不可变版本 API

**目标**

将合法草稿发布为导入建图可引用的不可变版本。

**API 建议**

- `POST /api/v1/schemas/{schemaId}/versions`
- `GET /api/v1/schemas/{schemaId}/versions`
- `GET /api/v1/schema-versions/{versionId}`
- `GET /api/v1/schema-versions?status=published`

**行为**

- 发布前执行 T03 全量校验。
- 版本号递增，保存发布人、时间、快照和哈希。
- 发布后不能修改；后续修改回到草稿并发布新版本。
- 建图接口只接受存在且已发布的 `versionId`。

**验收**

- 草稿发布 v1，再修改发布 v2，v1 内容不变。
- 建图 Schema 下拉只返回发布版本。
- `latest` 等漂移引用被拒绝。

---

## 6. M2：数据上传、映射与预检

### SI-T05 CSV 数据集上传与样本预览

**目标**

把用户已有点边 CSV 安全保存到后端托管目录，并返回可映射的列信息。

**API 建议**

- `POST /api/v1/datasets`（创建数据集）
- `POST /api/v1/datasets/{datasetId}/files`（multipart 上传）
- `GET /api/v1/datasets/{datasetId}`
- `GET /api/v1/datasets/{datasetId}/files/{fileId}/preview`
- `DELETE /api/v1/datasets/{datasetId}`（未被任务引用时）

**约束**

- 限制扩展名、MIME、单文件和总大小。
- 文件名由后端重新生成，不信任客户端路径。
- 禁止路径穿越。
- 检测编码、分隔符和表头；MVP 明确支持 UTF-8。
- 预览只返回有限行数，不把全文件装入内存。

**验收**

- 可上传多个点/边文件并查看列名和样本。
- 非 CSV、超限文件和危险文件名被拒绝。
- 数据文件默认不进入 Git。

### SI-T06 点边映射模型与 API

**目标**

把源 CSV 列映射到钉死 Schema 版本的 Tag/Edge。

**点映射至少包含**

- `fileId`
- 目标 `tagName`
- VID 来源列和可选转换
- 属性名 → 源列

**边映射至少包含**

- `fileId`
- 目标 `edgeName`
- src VID 列、dst VID 列
- 可选 rank 列/生成策略
- 属性名 → 源列

**API 建议**

- `POST /api/v1/mappings`
- `GET /api/v1/mappings/{mappingId}`
- `PUT /api/v1/mappings/{mappingId}`
- `DELETE /api/v1/mappings/{mappingId}`

**验收**

- 映射固定 `schemaVersionId`。
- 未知 Tag/Edge/属性立即拒绝。
- 至少包含一个点映射。
- 边端点映射完整。

### SI-T07 导入预检引擎与报告 API

**目标**

正式创建 Space 前发现数据质量错误。

**检查**

- CSV 结构与映射列存在。
- VID 非空、长度/格式符合策略。
- 点 VID 在同一 Tag 内不重复。
- 必填属性非空。
- 属性可转换为目标类型。
- 边 src/dst 非空；端点可在当前数据集点集合中解析。
- 错误样本脱敏且数量有上限。

**API 建议**

- `POST /api/v1/mappings/{mappingId}/preflight`
- `GET /api/v1/preflight-reports/{reportId}`

**报告**

- 总行数、抽样/全量模式。
- 有效行、错误行。
- 按错误码聚合。
- 行号、字段、脱敏样例和原因。
- 是否允许创建图。

**验收**

- 有错误时 `canCreateGraph=false`。
- 预检失败前不创建 Nebula Space。
- 大文件流式扫描，不一次读入内存。

---

## 7. M3：异步建图与目录闭环

### SI-T08 图实例创建意图与状态机

**目标**

创建持久化图实例和异步运行记录，提供任务查询接口。

**状态**

- 图实例：`creating | ready | failed | deleting`
- 导入任务：`pending | running | succeeded | failed | cancelled`
- 阶段：`create_space | apply_schema | write_vertices | write_edges | reconcile`

**API 建议**

- `POST /api/v1/graph-instances`
- `GET /api/v1/graph-instances`
- `GET /api/v1/graph-instances/{instanceId}`
- `GET /api/v1/ingestion-runs/{runId}`
- `POST /api/v1/graph-instances/{instanceId}/cleanup`

**创建门禁**

- Schema 版本已发布。
- 映射和成功预检报告属于同一版本/数据集。
- `spaceName` 合法且未登记。
- Nebula 物理 Space 不存在。
- 受保护空间（至少 `anti_fraud_kg`）不可作为目标。

**验收**

- POST 快速返回 `202 + runId`，不阻塞到导入完成。
- 状态迁移合法且有错误详情。
- 重复创建同名 Space 返回冲突。

### SI-T09 Nebula 建 Space 与应用 Schema

**目标**

实现后端受控 DDL 执行器。

**步骤**

1. 检查目标 Space 不存在。
2. `CREATE SPACE`，使用平台受控分区/副本/VID 配置。
3. 等待 Meta 同步。
4. 使用 T03 编译结果创建 Tag、Edge、Index。
5. 验证 `SHOW TAGS/EDGES` 或等价元数据。

**安全**

- 仅使用已经严格校验的标识符。
- 不允许请求上传任意 nGQL DDL。
- Nebula 管理凭据仅服务端持有。

**验收**

- 同一 Schema 版本可应用到两个不同新 Space。
- DDL 失败时图实例标记 `failed`，不进入可分析目录。
- 重试不静默覆盖已有成功图。

### SI-T10 CSV 流式写点、写边与对账

**目标**

按映射把已有 CSV 数据流式写入新 Space。

**执行顺序**

1. 所有点文件。
2. 所有边文件。
3. 索引处理（创建/重建时机由实现统一）。
4. 行数对账与抽样 `FETCH`。

**要求**

- 批量大小可配置且有上限。
- 复用安全字面量转义/类型转换。
- 记录处理、成功、失败数量和当前阶段。
- 错误达到阈值立即失败。
- 不回退 Mock。
- 任务重启语义明确：MVP 可要求清理失败实例后重新创建。

**验收**

- 固定测试数据的点边数量和关键属性一致。
- 边写入前目标点已成功写入。
- 百万级不在内存保存全部记录。

### SI-T11 图实例目录接入探索分析

**目标**

创建成功的新图无需手改环境变量即可出现在探索分析。

**改造**

- `graph_space_service` 合并：
  - SQLite 中 `ready` 图实例；
  - `NEBULA_SPACE/NEBULA_EXTRA_SPACES` 运维兜底。
- 同名时图实例元数据优先，去重保序。
- `creating/failed` 可在管理页展示，但不能作为可查询 ready Space。

**验收**

- 建图成功后刷新探索分析即可选中。
- 建图失败的 Space 不出现在可查询列表。
- 已有环境变量空间保持兼容。

---

## 8. M4：前端主流程

### SI-T12 模型构建页 API 化

**目标**

将 `ModelBuilder.tsx` 从 `schema-store/localStorage` 迁到后端 Schema API。

**范围**

- 加载/创建 Schema。
- 保存草稿。
- 展示校验错误。
- 发布版本和查看版本列表。
- 防止编辑已发布快照。

**验收**

- 刷新/换浏览器后数据仍存在。
- 无 `schema.write` 时只读。
- API 错误不伪装保存成功。

### SI-T13 上传、映射和预检向导

**目标**

在数据接入页完成主路径的前半段。

**步骤 UI**

1. 选择已发布 Schema 版本。
2. 创建数据集并上传 CSV。
3. 为文件选择 Tag/Edge。
4. 配 VID/src/dst/rank 和属性映射。
5. 执行预检并展示错误报告。

**验收**

- 未发布 Schema 不出现在下拉。
- 映射不完整无法进入下一步。
- 预检错误可定位到文件、行、字段。

### SI-T14 创建图、任务进度和结果页

**目标**

完成「确认创建 → 跟踪任务 → 打开新图」。

**范围**

- 输入展示名与 Space 名。
- 提交创建请求。
- 展示阶段、行数、状态和错误摘要。
- 成功后提供「去探索分析」。
- 失败后提供查看错误和显式清理入口。

**验收**

- 页面刷新后可继续查看任务。
- 成功状态来自后端，不由前端定时器伪造。
- 无 `ingestion.write` 时不可提交。

---

## 9. M5：测试、文档与验收

### SI-T15 后端测试

**单元**

- SQLite 约束和状态机。
- Schema 校验、版本不可变、DDL 编译。
- CSV 类型转换、转义、VID/端点校验。
- Space 名和路径安全。

**API**

- RBAC/CSRF。
- 草稿不可建图。
- 预检失败不可建图。
- 同名 Space 冲突。
- 图实例目录只包含 ready。

**集成**

- 临时 Space：创建 → DDL → 导入测试 CSV → 点边抽查 → 清理。
- Nebula 不可用/DDL 失败/批次失败时状态正确。

### SI-T16 前端测试与静态检查

- API Client 类型和请求体。
- Schema 发布后才可选择。
- 映射向导门禁。
- 任务状态渲染。
- `npm/pnpm` 类型检查、lint、构建通过。

### SI-T17 文档与端到端验收

**文档**

- `docs/change/YYYY-MM-DD-schema-ingestion-phase1.md`
- GitHub 操作指南：准备 CSV、发布 Schema、配置映射、创建图、查看任务。
- CSV 示例与字段规则。
- 失败实例清理说明。

**P0 端到端**

1. 创建 Schema 草稿并发布 v1。
2. 上传至少一个点 CSV 和一个边 CSV。
3. 映射并预检通过。
4. 创建新图。
5. 等待任务成功。
6. 探索分析选择新图。
7. 按已知 VID 点查并展开关系。
8. 注入坏类型/空 VID，确认预检阻断。
9. 断开 Nebula，确认失败且不返回 Mock。

## 10. 本批明确不做

- MySQL/Hive/Oracle/Kafka/MaxCompute 真连接器。
- JSON 导入和直接 Space-to-Space 复制。
- 对 ready 图追加导入。
- 破坏性 Schema 在线迁移。
- per-space RBAC。
- 全图 `MATCH count()` 作为唯一对账手段。
- 浏览器端保存管理凭据或执行任意 DDL。

## 11. 建议首轮编码范围

为控制风险，首轮只做：

```text
SI-T01 → T02 → T03 → T04
```

交付结果是“Schema 服务端生命周期可用”。通过评审后再进入 CSV 与建图执行器，避免同时重构 ModelBuilder、DataIngestion、SQLite 和 Nebula 写入链路。
