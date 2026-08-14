# 对公贷款反欺诈知识图谱 — 架构说明

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                         前端 SPA                              │
│  (HTML/CSS/ES2020 + Canvas 力导向图)                         │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST / CORS
┌───────────────────────────▼─────────────────────────────────┐
│                      FastAPI 后端                            │
│  - /api/fund-flow/*      信贷资金流向穿透                      │
│  - /api/guarantee/*      担保圈与集团派系识别                  │
│  - /api/lost-customers   失联客户追踪                          │
│  - /api/graph/expand     通用图谱扩展                         │
│  - /api/query            nGQL 查询工作台                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ nebula3-python
┌───────────────────────────▼─────────────────────────────────┐
│                    Nebula Graph 图数据库                      │
│  图空间：anti_fraud_kg                                       │
│  点：company / person / account / loan                        │
│  边：holds_account / applied_for / disbursed_to / transfer   │
│       guarantees / controls / shareholder / employs          │
│       related_to                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心反欺诈能力

### 2.1 信贷资金流向穿透

| 子能力 | 图模型表达 | nGQL 技术 |
| --- | --- | --- |
| 贷款回流 | `loan -(disbursed_to)-> account -(transfer*..)-> account -(related_to)-> person -(controls)-> company` | 多跳路径 + 起点/终点关联 |
| 洗钱路径 | `account -(transfer*3..6)-> account` | 可变跳数路径排序 |
| 虚增流水 | `account -(transfer*2..6)-> account` | 自环/闭环检测 |
| 垒大户 | `account -(transfer)-> account` + 聚合 | 出度/累计金额排序 |

### 2.2 担保圈与集团派系识别

- **担保圈**：`company -(guarantees*2..6)-> company` 环检测。
- **集团派系**：通过 `guarantees | shareholder | employs | related_to` 多关系扩展，发现隐性集团。
- **风险传染**：结合担保金额、企业风险分，评估单点违约影响范围。

### 2.3 失联客户追踪

- **失联判定**：`company` 属性 `is_lost=true` 且 `lost_days >= 阈值`。
- **关系触达**：`company -(controls|employs|related_to*1..3)- person` 寻找可联人。
- **地址核验**：通过 `related_to` 边关联同一注册地企业。

## 3. 前端可视化

- 基于 HTML5 Canvas 自研力导向图，无外部 JS 依赖。
- 支持：拖拽节点、平移画布、滚轮缩放、节点悬停/选中、图例说明。
- 节点颜色：
  - 企业 `#0075ff`
  - 个人 `#00d187`
  - 账户 `#ffab00`
  - 贷款 `#db2828`

## 4. 离线演示

- 后端未连接 Nebula Graph 时自动进入 **Mock 模式**，返回演示图数据。
- 前端同时内置 MOCK 数据，即使后端不可访问也能展示界面。
