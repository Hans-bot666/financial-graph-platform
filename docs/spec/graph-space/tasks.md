# 图空间选择 — 实施任务

- 状态：Ready for implementation
- 版本：0.1.0
- 更新时间：2026-09-11
- 依据：[README.md](README.md)、[selection.spec.md](selection.spec.md)

## 已拍板（开放问题默认）

| # | 决定 |
| --- | --- |
| 1 | 图查询 / 场景执行请求体 **`space` 必填**，缺省不静默回落 |
| 2 | 目录 = `NEBULA_SPACE` + `NEBULA_EXTRA_SPACES`（逗号分隔）；展示名用内置映射，未知 id 则用 id 本身 |
| 3 | Phase 1 `status` 静态为 `ready`（配置非法则丢弃，不做每次 `USE` 探测） |
| 4 | 场景执行 **跟随** 当前 UI 选中的 `space` |

## 任务总览

| ID | 任务 | 优先级 | 依赖 | 预估 |
| --- | --- | --- | --- | --- |
| GS-T01 | 后端：目录配置与 `GraphSpaceSummary` 模型 | P0 | — | S |
| GS-T02 | 后端：`GET /api/v1/graph/spaces` | P0 | T01 | S |
| GS-T03 | 后端：校验 `space` + 按请求安全 `USE`（防串空间） | P0 | T01 | M |
| GS-T04 | 后端：lookup / expand / paths / scenarios / readonly 携带并使用 `space` | P0 | T03 | M |
| GS-T05 | 后端单测：目录、校验、拒绝未知、交替 space | P0 | T02–T04 | M |
| GS-T06 | 前端：`listGraphSpaces` 与请求体带 `space` | P0 | T02,T04 | S |
| GS-T07 | 前端：探索分析下拉改接目录、切换清空、本地记忆 | P0 | T06 | M |
| GS-T08 | 文档与本地配置示例（含百万空间） | P1 | T01 | S |
| GS-T09 | 联调验收清单（手工） | P0 | T05,T07 | S |
| GS-T10 | （可选 P1）数据接入 / 特征页若复用列表则对齐 API | P1 | T06 | S |

---

## GS-T01 后端目录配置与模型

**做什么**

- 在 `config`（或等价模块）解析：
  - `NEBULA_SPACE` → 默认项，`isDefault=true`
  - `NEBULA_EXTRA_SPACES` → 逗号拆分追加（去重、保序）
- 校验 space id 格式（仅允许安全字符集）；非法项丢弃并打日志
- 内置 `displayName` 映射，至少覆盖：
  - `anti_fraud_kg` → 对公贷款反欺诈图
  - `random_financial_graph_million` → 百万随机金融图
- 新增契约：`GraphSpaceSummary`（字段对齐规格）

**验收**

- 仅设默认时目录 1 条；追加 `NEBULA_EXTRA_SPACES` 后可见多条
- 非法 id 不出现在目录

**涉及（预计）**

- `backend/config.py`、`backend/app/contracts.py`、新建 `graph_space_service`（或类似）

---

## GS-T02 `GET /api/v1/graph/spaces`

**做什么**

- 注册列表接口，权限与其他图读接口一致（现有 `require_permission`）
- 返回目录数组（含 `isDefault`）
- Phase 1 不做 Nebula `SHOW SPACES` 作为权威源

**验收**

- 未登录 / 无权限 → 与现有图 API 相同拒绝策略
- 已登录 → 返回白名单目录 JSON

---

## GS-T03 校验与按请求 `USE`（防串空间）

**做什么**

- `resolve_space(space: str) -> GraphSpaceSummary`：不在目录或非 ready → 抛业务错误（映射规格错误码）
- `USE` 仅使用校验通过后的精确 id，禁止未校验拼接
- 改造 `nebula_client`（或查询执行层）：按请求切换 space 时 **并发不串读**
  - 推荐：请求级锁 / 短临界区「USE + 查询」，或文档化等价方案
- 明确全局默认 session 在请求后的行为（恢复默认或每次请求都显式 USE）

**验收**

- 未知 `space` 失败且不执行业务查询
- 交替两空间查询结果不串（单测或集成测）

---

## GS-T04 图查询与场景 API 必填 `space`

**做什么**

- 为下列请求模型增加必填 `space: str`：
  - `VertexLookupRequest`
  - `GraphExpandRequest`
  - `PathFindRequest`
  - `ScenarioExecuteRequest`
  - `ReadonlyQueryRequest`（若前端/OpenAPI 仍暴露）
- Router → service 全链路传入已校验 space，执行前 `USE`
- 去掉服务层对硬编码 `USE anti_fraud_kg;` 的依赖（`scenario_service` / `main.py` 遗留示例若在运行路径上一并改）

**验收**

- 缺 `space` → 422
- 带合法 `space` → 在对应空间执行
- OpenAPI `/docs` 可见新字段

---

## GS-T05 后端测试

**做什么**

- 目录解析：默认、额外、去重、非法丢弃、展示名
- API：列表 200；未知 space 查询失败
-（可用 mock client）验证执行路径调用了目标 space 的 USE
- 若可测：锁/串行下交替 space 不串

**验收**

- `python -m unittest …` 相关用例通过

---

## GS-T06 前端 API Client

**做什么**

- `graph-api.ts`：`listGraphSpaces()`
- `lookupVertex` / `expandVertex` / `findPaths` / `executeScenario` /（若有）只读查询增加 `space` 参数并写入 JSON body
- 类型与后端字段对齐（`displayName` / `spaceName` 映射在 UI 层处理）

**验收**

- 网络请求 body 含所选 `space`
- 列表接口可独立调用

---

## GS-T07 探索分析页接目录

**做什么**

- 「当前分析图」数据源改为 `listGraphSpaces()`，不再以 `builtinGraphInstances()` 为唯一来源
- 选择态用 space `id`；展示 `displayName · id`
- 非 `ready`：`disabled`
- 切换：清空画布 + `lastResult`（保持现有清空逻辑并确认完整）
- `localStorage` 记住上次 space；无效则默认 `isDefault`，再否则第一条 ready
- 目录加载失败：明确错误提示，禁止伪装成功目录
- 所有查询/场景按钮在无有效 space 时禁用

**验收**

- 配置两空间时下拉两项可选
- 切换后画布空；查询带正确 space
- 刷新后尽量恢复上次选择

---

## GS-T08 文档与配置示例

**做什么**

- README 或 `docs/guides` 补充：`NEBULA_EXTRA_SPACES` 示例
- 在图空间 spec README 链到本 tasks
- 变更说明可在实现后写 `docs/change/2026-09-11-graph-space-selection.md`（实现阶段产出，本 task 可先写配置小节）

**验收**

- 新人按文档能把百万空间挂进下拉

---

## GS-T09 联调验收（手工）

对照规格 §6：

1. 目录可见两空间  
2. 百万空间查 `million_` 有结果；切回 `anti_fraud_kg` 不串  
3. 伪造 `space=not_in_catalog` 失败  
4. 交替查询正确  
5. 断 Nebula / 断目录时前端失败可见  

**验收**：检查项全部打勾后合并。

---

## GS-T10 （P1 可选）其他页面列表对齐

- `DataIngestion` / `FeatureFactory` 若仍读 `ingestion-store` 硬编码列表：Phase 1 可不动；若造成「两套图列表」困惑，再改为同一 API 或明确文案「仅探索分析支持多空间」。

---

## 建议实施顺序

```text
T01 → T02 → T03 → T04 → T05
                ↘
                 T06 → T07 → T09
T08 可与 T04–T07 并行
T10 可选，不阻塞 Phase 1
```

## 明确不做（本批 Task 外）

- per-space RBAC
- `SHOW SPACES` 当权威目录
- 全图 COUNT 统计
- 在线创建/删除 Space
- SQLite 元数据目录（Phase 2）
