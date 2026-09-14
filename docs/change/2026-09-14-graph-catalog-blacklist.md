# 图目录改为 SHOW GRAPHS + 黑名单（Phase 1.1）

- 日期：2026-09-14
- 规格：`docs/spec/graph-space/`
- 任务：`docs/spec/graph-space/tasks.md`（GS-T11–T16）

## 变更摘要

1. `GET /api/v1/graph/spaces` 不再以 `NEBULA_SPACE` + `NEBULA_EXTRA_SPACES` 白名单为权威。
2. 后端对 NebulaGraph 5.x catalog 执行 `SHOW GRAPHS`（不预选 Graph），去掉 `NEBULA_HIDDEN_GRAPHS` 中的 id 后返回目录。
3. 查询仍必填 `space`；不在库中 → `SPACE_NOT_FOUND`；在黑名单 → `SPACE_FORBIDDEN`；目录查询失败 → `CATALOG_UNAVAILABLE`。
4. 探索分析、特征工厂选图均使用该目录 API。

## 配置

```bash
NEBULA_SPACE=anti_fraud_kg
# 逗号分隔；留空表示库中 Graph 全部可见
NEBULA_HIDDEN_GRAPHS=
```

`NEBULA_EXTRA_SPACES` 已废弃，写入后不再影响目录。

## 联调验收清单

- [ ] 登录后 `/api/v1/graph/spaces` 列出库中 Graph，无需 EXTRA
- [ ] `NEBULA_HIDDEN_GRAPHS` 中的 Graph 不出现在列表
- [ ] 请求隐藏 Graph 的 `space` 返回 403 `SPACE_FORBIDDEN`
- [ ] 选百万图，查 `million_` 前缀点有结果
- [ ] 切回 `anti_fraud_kg` 查同一 million id 无串读
- [ ] `space=not_in_catalog` 返回 404 `SPACE_NOT_FOUND`
- [ ] 缺 `space` 返回 422
- [ ] `SHOW GRAPHS` / 目录加载失败时前端提示错误，不伪装成功

## 非目标（未做）

- per-space RBAC、全图 COUNT、在线建删 Graph、SQLite 图实例元数据
