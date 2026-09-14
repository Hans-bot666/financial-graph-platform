# 基于 Schema 从已有数据创建图

## 1. 文档信息

- 状态：Draft
- 版本：0.1.0
- 更新时间：2026-09-14
- 适用范围：模型构建（Schema）、数据接入、图实例（Nebula Space）、与探索分析图空间选择的衔接

本目录只包含规格（Spec）。Task 拆分与写码在后续评审后进行。

## 2. 规格目录

| 文档 | 内容 | 阶段 |
| --- | --- | --- |
| [create-graph-from-data.spec.md](create-graph-from-data.spec.md) | 主路径：已有数据 + Schema → 创建新图 | Phase 1 |
| （后续）schema-template.spec.md | Schema 草稿/发布/版本（可与现有设计稿对齐后拆出） | Phase 1–2 |

相关既有设计（非本目录 Spec，供对齐）：

- [`docs/schema-and-ingestion-design.md`](../../schema-and-ingestion-design.md)
- [`docs/spec/graph-space/`](../graph-space/)（分析侧选已有图）
- [`docs/enterprise-platform-integration-plan.md`](../../enterprise-platform-integration-plan.md) Phase 3

## 3. 为什么要做（Why）

### 3.1 业务主诉求（用户原话归纳）

平台最主要的能力不是“只能分析已经手工建好的 Space”，而是：

> **导入已有图数据 → 按选定 Schema 建成一张新图。**

用户可能已有业务导出、表数据或其它图快照；需要先有清晰的点边模型（Schema），再把数据清洗/映射后落到**新的图实例**上，供探索分析使用。

### 3.2 现状问题

1. **建图路径断裂**  
   当前多靠脚本（`schema.ngql` + `generate_*_graph.py`）或手工 nGQL。前端「模型构建 / 数据接入」偏 Demo 本地态，**不能**完成「选 Schema → 创建新图 → 导入已有数据」闭环。

2. **概念易混**  
   Schema、图空间、导入映射、分析下拉混在一起。用户不清楚：库内必须先有 Space；产品上却可以先有 Schema 模板。

3. **分析能力已超前于建图**  
   图空间选择（白名单 + 按 `space` 查询）已打通「查已有图」；若没有「按 Schema 从数据建新图」，平台只是多图浏览器，不是完整图谱工作台。

4. **已有数据无法规范化复用**  
   没有「固定 Schema 版本 + 映射 + 新 Space」闸门时，脏数据、漂移字段、误写入业务空间（如 `anti_fraud_kg`）风险高。

### 3.3 要解决的核心矛盾

> 用户心智是「先模型、再选模型灌已有数据成新图」；引擎事实是「先 Space、再 Schema、再数据」。

平台必须用元数据与编排把两者接起来：**对外按用户心智，对内按 Nebula 顺序自动执行。**

### 3.4 本期目标

1. 明确三类对象：**Schema 模板（含已发布版本）**、**图实例（= 一个 Nebula Space + 绑定的 Schema 版本）**、**导入任务（已有数据 → 映射 → 写入图实例）**。
2. 打通主路径：**已有数据 + 已发布 Schema → 创建新图实例并导入**。
3. 新图自动进入可分析目录（与图空间选择衔接），无需再手改环境变量作为唯一手段（Phase 1 可先登记到平台目录，再同步/配置 Nebula）。
4. 导入前强制校验：类型、VID、端点引用等；失败可定位，禁止静默写坏图。

### 3.5 非目标（本期不做或后置）

- 浏览器直连 Nebula 做 DDL/导入。
- 在已有生产 Space上「热改 Schema 并原地灌数」作为主路径（破坏性变更走新版本 + 新图或正式迁移流程）。
- 完整多数据源连接器矩阵（Hive/Kafka 等可后置；Phase 1 优先文件/已有导出类）。
- per-space 细粒度 RBAC（沿用现有角色权限粒度，后续再拆）。
- 全图 COUNT 作为创建成功的唯一验收（大图用抽样/任务计数）。

### 3.6 设计原则

| 原则 | 说明 |
| --- | --- |
| 主路径优先 | 「已有数据 → Schema → 新图」是 P0，空图只建 Schema 是辅助 |
| 模板与实例分离 | Schema 可复用；每张新图是独立 Space |
| 版本钉死 | 导入与图实例绑定 `schema_id + version_id`，禁止“永远最新” |
| 后端编排 | CREATE SPACE / 应用 DDL / 导入均由 FastAPI 执行 |
| 与分析衔接 | 创建成功的图实例对探索分析可选 |

## 4. 概念模型

```text
Schema 模板 (平台元数据)
  └─ 已发布版本 vN（不可变点/边快照）
           │
           │  创建图时选用
           ▼
图实例 GraphInstance
  ├─ 展示名、状态（creating/ready/failed）
  ├─ nebula_space_name
  └─ bound schema_version_id
           ▲
           │  写入
导入任务 IngestionJob
  ├─ 数据来源（已有文件/已有图导出/表 —— Phase 1 先定范围）
  ├─ 字段映射（符合该 schema_version）
  └─ 运行记录（成功行/失败行/错误样本）
```

Nebula 实际顺序（编排隐藏细节）：

```text
CREATE SPACE → 等待就绪 → 应用 schema_version 的 DDL → 按映射 INSERT/批量导入
```

## 5. 与现有能力关系

| 能力 | 关系 |
| --- | --- |
| 图空间选择 GS-SEL | 消费「已 ready 的图实例」；本功能负责生产实例 |
| `schema.ngql` / 随机图脚本 | 开发压测捷径；正式主路径应被平台编排替代或仅作兜底 |
| `schema-and-ingestion-design.md` | 元数据与门禁与之对齐；本 Spec 突出「建新图」主用例 |
| 模型构建前端 | 产出 Schema 草稿/发布；本 Spec 要求发布后才能被「创建图」引用 |

## 6. 成功标准（摘要）

1. 用户可选择**已发布 Schema 版本**与**已有数据源/文件**，发起「创建新图」。
2. 系统创建独立 Nebula Space，写入符合该版本的点边数据。
3. 任务结束后图实例为 `ready`，出现在探索分析可选列表中。
4. 映射错误、类型错误在导入前或任务报告中可见，不产生“假成功”。

详细需求见 [create-graph-from-data.spec.md](create-graph-from-data.spec.md)。
