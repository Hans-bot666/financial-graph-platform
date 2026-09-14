# 图空间选择（Phase 1）

- 日期：2026-09-11
- 规格：`docs/spec/graph-space/`
- 任务：`docs/spec/graph-space/tasks.md`（GS-T01–T09）

## 变更摘要

1. 后端维护图空间白名单目录：`NEBULA_SPACE` + `NEBULA_EXTRA_SPACES`。
2. 新增 `GET /api/v1/graph/spaces`。
3. 点查 / 展开 / 路径 / 场景 / 只读 GQL 请求体必填 `space`；校验通过后 `execute_in_space`（持锁 USE，防串空间）。
4. 探索分析页下拉改为目录 API，切换清空画布，并本地记忆上次选择。

## 配置

```bash
NEBULA_SPACE=anti_fraud_kg
NEBULA_EXTRA_SPACES=random_financial_graph_million
```

## 联调验收清单

- [ ] 登录后 `/api/v1/graph/spaces` 可见默认空间；配置 EXTRA 后可见百万空间
- [ ] 选百万空间，查 `million_` 前缀点有结果
- [ ] 切回 `anti_fraud_kg` 查同一 million id 无串读
- [ ] `space=not_in_catalog` 返回 404 `SPACE_NOT_FOUND`
- [ ] 缺 `space` 返回 422
- [ ] 目录加载失败时前端提示错误，不伪装成功

## 非目标（未做）

- per-space RBAC、SHOW SPACES 权威目录、全图 COUNT、在线建删 Space
