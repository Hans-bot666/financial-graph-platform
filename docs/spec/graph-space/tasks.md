# 图空间选择 — 实施任务

- 状态：Ready for implementation
- 版本：0.2.0
- 更新时间：2026-09-14
- 依据：[README.md](README.md)、[selection.spec.md](selection.spec.md)

Phase 1（GS-T01–T09）已落地：请求携带 `space`、按请求切换 Graph、探索分析接下拉。本期 **Phase 1.1** 把目录权威从白名单改为 `SHOW GRAPHS` + 黑名单。

## 已拍板

| # | 决定 |
| --- | --- |
| 1 | 图查询 / 场景执行请求体 **`space` 必填**，缺省不静默回落 |
| 2 | 目录 = `SHOW GRAPHS` 减去 `NEBULA_HIDDEN_GRAPHS`；展示名用内置映射，未知 id 用 id 本身 |
| 3 | 成功发现的 Graph `status` 静态为 `ready`（非法名丢弃） |
| 4 | 场景执行 **跟随** 当前 UI 选中的 `space` |
| 5 | `NEBULA_EXTRA_SPACES` 废弃，不再参与目录 |
| 6 | 特征工厂选图与探索分析使用同一目录 API |

## 任务总览

| ID | 任务 | 优先级 | 依赖 | 预估 |
| --- | --- | --- | --- | --- |
| GS-T11 | 后端：`SHOW GRAPHS` 发现 + 黑名单配置 | P0 | — | M |
| GS-T12 | 后端：`resolve_space` 按可见目录校验（含 FORBIDDEN） | P0 | T11 | S |
| GS-T13 | 后端单测：发现、过滤、拒绝隐藏/未知、交替 space | P0 | T11–T12 | M |
| GS-T14 | 前端：探索分析文案；特征工厂接下拉 API | P0 | T11 | S |
| GS-T15 | 文档与配置示例（废弃 EXTRA，新增 HIDDEN） | P1 | T11 | S |
| GS-T16 | 联调验收清单（手工） | P0 | T13,T14 | S |

---

## GS-T11 后端发现与黑名单

**做什么**

- `nebula_client.list_graphs()`：执行 `SHOW GRAPHS`，**不**预选 Graph。
- Mock：返回至少 `anti_fraud_kg`，`is_mock=true`。
- `config.NEBULA_HIDDEN_GRAPHS`：逗号拆分；非法 id 丢弃并打日志。
- `graph_space_service.list_graph_spaces()`：发现 → 过滤黑名单 → 组装 `GraphSpaceSummary`。
- `NEBULA_SPACE` 若在可见列表中则 `isDefault=true`，并尽量排在目录前部。
- `GET /api/v1/graph/spaces`：目录失败映射 `CATALOG_UNAVAILABLE` / 502。

**验收**

- 库中两张图、黑名单空 → 目录两条
- 黑名单含其中一张 → 目录仅剩其余
- `SHOW GRAPHS` 失败 → 502，不回落旧白名单

**涉及（预计）**

- `backend/config.py`、`backend/nebula_client.py`、`backend/app/services/graph_space_service.py`、`backend/app/api/v1/router.py`

---

## GS-T12 校验

**做什么**

- `resolve_space`：空 → `SPACE_REQUIRED`；格式非法或不在发现结果 → `SPACE_NOT_FOUND`；在黑名单 → `SPACE_FORBIDDEN`；非 ready → `SPACE_NOT_READY`。
- `SESSION SET GRAPH` 仅使用校验通过后的精确 id。

**验收**

- 隐藏 Graph 的查询不执行业务 GQL
- 未知 Graph 失败且不执行业务查询

---

## GS-T13 后端测试

**做什么**

- 解析 `SHOW GRAPHS` 行（Name 列 / 首个合法字符串）
- 黑名单过滤、默认排序、非法 id 丢弃
- API：可见目录；隐藏 → 403；未知 → 404；交替 space 不串

**验收**

- `python -m unittest` 相关用例通过

---

## GS-T14 前端

**做什么**

- 探索分析：下拉仍接 `listGraphSpaces()`；失败不清空伪装；文案改为「图数据库中的可用图」，不再写「已登记白名单」。
- 特征工厂：选图改为 `listGraphSpaces()`，使用 Graph `id` 作为 `graphInstanceId`；加载失败明确 toast。
- 不把 `ingestion-store` builtin 当作探索/特征的唯一来源。

**验收**

- 库中新增 Graph 后刷新探索分析可见（无需改 EXTRA）
- 特征工厂下拉与探索分析条目一致（同源 API）

---

## GS-T15 文档与配置示例

**做什么**

- `.env.example`、README、`docs/guides/random-graph-*.md`：去掉「追加 EXTRA 白名单才能看到」；改为「建图后刷新目录；隐藏则写 `NEBULA_HIDDEN_GRAPHS`」
- 变更说明：`docs/change/2026-09-14-graph-catalog-blacklist.md`

**验收**

- 新人按文档能理解：不用白名单登记，用黑名单隐藏

---

## GS-T16 联调验收（手工）

对照规格 §6：

1. 库中两图、黑名单空 → 下拉两项  
2. 配置隐藏百万图 → 下拉消失；查询该 space → 403  
3. 百万图可见时查 `million_` 有结果；切回 `anti_fraud_kg` 不串  
4. 伪造 `space=not_in_catalog` 失败  
5. 断 Nebula 时目录接口失败可见，前端不伪装成功  

**验收**：检查项全部打勾后合并。

---

## 建议实施顺序

```text
T11 → T12 → T13
         ↘
          T14 → T16
T15 可与 T13–T14 并行
```

## 明确不做（本批 Task 外）

- per-space RBAC
- 全图 COUNT 统计
- 在线创建/删除 Graph
- SQLite 元数据目录（Phase 2）
- 恢复 `NEBULA_EXTRA_SPACES` 白名单权威
