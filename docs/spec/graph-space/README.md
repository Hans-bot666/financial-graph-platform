# 图空间选择功能规格

## 1. 文档信息

- 状态：Ready for implementation
- 版本：0.2.0
- 更新时间：2026-09-14
- 适用范围：探索分析页图空间切换、特征工厂选图、FastAPI 图查询 API、NebulaGraph 5.x 多 Graph

规格与实施任务已拆分：先看 Spec，再按 [tasks.md](tasks.md) 落地。

## 2. 规格与任务目录

| 文档 | 内容 | 阶段 |
| --- | --- | --- |
| [selection.spec.md](selection.spec.md) | 图空间目录、选择态、按空间查询与安全校验 | Phase 1.1 |
| [tasks.md](tasks.md) | 实施任务拆分、拍板项与验收顺序 | Phase 1.1 |

## 3. 为什么要做（Why）

### 3.1 现状问题

1. **目录是运维白名单，不是库里的真图**  
   Phase 1 用 `NEBULA_SPACE` + `NEBULA_EXTRA_SPACES` 登记可查询图。库里新建 Graph 后，必须改环境变量并重启后端，前端下拉才出现。

2. **脚本与分析仍脱节**  
   一万 / 百万随机图写入后，若忘了追加白名单，探索分析看不到；运维误把系统图写进白名单，则会暴露不应展示的 Graph。

3. **产品预期是「库里有几张图就显示几张」**  
   需要隐藏的图用黑名单排除，而不是把可见图一条条登记。

### 3.2 要解决的核心矛盾

> 图数据已在 NebulaGraph catalog 中，平台交互却只展示配置里写死的那几张。

### 3.3 本期目标（What we want now）

1. 已登录用户能看到 **图数据库当前存在、且不在黑名单中的 Graph 列表**。
2. 探索分析、特征工厂用同一目录 API 驱动下拉。
3. 点查 / 展开 / 路径 / 场景等图查询仍携带 `space`，后端校验后在该 Graph 执行。
4. 黑名单中的 Graph 不出现在目录，手工构造请求也不得查询。
5. 禁止任意字符串作为 Graph 名直通 Nebula。

### 3.4 本期不做（Non-goals）

- 租户 / 机构 / 部门级图空间数据隔离（仍属授权后续阶段）。
- 在线创建、删除、改名图空间或在线改 Schema。
- 全图精确 `COUNT` 统计作为列表必填字段。
- 前端直连 NebulaGraph 或在浏览器持有图库凭证。
- per-space RBAC（任何有图读权限的用户看到同一过滤后目录）。

### 3.5 设计原则

| 原则 | 说明 |
| --- | --- |
| 后端为权威 | 可查询 Graph 列表与最终 `SESSION SET GRAPH` 目标由后端决定 |
| 库为目录源 | 权威来源是 NebulaGraph 5.x catalog（`SHOW GRAPHS`），不是前端硬编码 |
| 黑名单过滤 | 配置只声明「不展示 / 不可查」的 Graph，默认其余全部可见 |
| 显式携带 | 每次图分析请求声明 `space`，不依赖隐式全局单例 |
| 与现有 UI 对齐 | 复用探索分析页「当前分析图」下拉，特征工厂选图接同一 API |

## 4. 目标

1. 提供从库实时发现、经黑名单过滤的图目录 API。
2. 探索分析、特征工厂用真实目录驱动下拉与当前选择。
3. 图查询与场景执行按所选 Graph 执行。
4. 错误可诊断：图不存在、已列入黑名单、目录查询失败、Nebula 不可用。

## 5. 范围

### Phase 1（已完成）

- 请求体必填 `space`；校验后按请求切换 Graph，防串空间。
- 探索分析加载目录、切换、按空间发请求。

### Phase 1.1（本期）

- 目录权威改为 `SHOW GRAPHS`；`NEBULA_HIDDEN_GRAPHS` 黑名单过滤。
- 查询 API 只允许目录中可见且 `ready` 的 Graph。
- 特征工厂选图改为同一目录 API。

### Phase 2（预留）

- SQLite / 元数据库持久化图实例、Schema 版本、导入任务关联。
- 按角色/用户授权可见空间集合。
- 可选的近似统计与「就绪」探测。

## 6. 总体架构

```text
React 探索分析 / 特征工厂
  ├─ 当前分析图下拉 ← GET /api/v1/graph/spaces
  ├─ 本地记住上次选择（可选）
  └─ lookup / expand / paths / scenarios 请求体携带 space
          │ 同源 / Cookie 会话
FastAPI
  ├─ SHOW GRAPHS（catalog，不预选 Graph）
  ├─ 减去 NEBULA_HIDDEN_GRAPHS
  ├─ 校验 space ∈ 可见目录且 status 可用
  └─ SESSION SET GRAPH {space} 后执行受控 GQL
          │
NebulaGraph 5.x
  ├─ anti_fraud_kg
  ├─ random_financial_graph_million
  └─ …（黑名单内的 Graph 对 API 不可见、不可查）
```

## 7. 与现有模块关系

| 模块 | 关系 |
| --- | --- |
| 认证 / RBAC | 沿用现有登录与图查询权限；不做 per-space ACL |
| `ingestion-store` | 本地导入任务态可保留；分析 / 特征选图不得再把它当作唯一来源 |
| `NEBULA_SPACE` | 保留为**默认 Graph**（`isDefault`、健康检查）；不再是「唯一可查询图」 |
| `NEBULA_EXTRA_SPACES` | **废弃**，不再作为目录来源 |
| 随机图脚本 | 写入后无需改白名单即可出现在下拉；若需隐藏则加入黑名单 |

## 8. 成功标准（验收摘要）

1. 库中存在且未列入黑名单的 Graph 出现在 `GET /api/v1/graph/spaces`。
2. 黑名单中的 Graph 不出现在目录；带该 `space` 的查询返回 `SPACE_FORBIDDEN`。
3. 切换到百万图后，查询 `million_*` VID 有结果；切回 `anti_fraud_kg` 后同一查询不应误命中百万数据。
4. 请求未带 `space`、带不存在或已隐藏的 `space` 时，API 明确失败，不得静默落到默认 Graph。
5. 浏览器网络面板中无 Nebula 账号密码。

详细需求与验收见 [selection.spec.md](selection.spec.md)。
