# 金融图谱平台 API v1 契约

## 范围

`/api/v1` 是新图谱分析工作台与 FastAPI 服务之间的稳定边界。NebulaGraph SDK 的原始对象不得直接暴露给浏览器。现有 `/api/*` 接口暂时保留，供旧前端迁移期间使用。

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/scenarios` | 返回版本化分析场景及参数定义 |
| POST | `/api/v1/scenarios/loan-reflux/executions` | 执行贷款回流场景 |
| POST | `/api/v1/scenarios/guarantee-circle/executions` | 执行担保圈识别场景 |
| POST | `/api/v1/scenarios/lost-customer/executions` | 执行失联客户追踪场景 |
| POST | `/api/v1/graph/query` | 执行受限只读 nGQL 查询 |

场景执行请求：

```json
{"parameters":{"companyName":"凯达建材有限公司"}}
```

## 统一图结果

所有图分析接口统一返回 `GraphResult`：

```json
{
  "title": "贷款回流路径",
  "nodes": [{"id":"c1","label":"企业A","type":"company","properties":{},"risk":80}],
  "edges": [{"id":"e1","source":"c1","target":"a1","type":"holds_account","label":"开户","properties":{}}],
  "columns": [],
  "rows": [],
  "summary": [],
  "warnings": [],
  "traceId": "...",
  "executionTimeMs": 12,
  "truncated": false
}
```

约束：节点 ID 和边的 `source`/`target` 均为字符串；边不再混用 `from`/`to`；每次执行必须返回 `traceId` 与耗时。

## 查询安全边界

v1 查询接口拒绝数据和模式写入语句，并将结果上限控制为 500 行。当前实现是第一阶段的词法安全门；生产试点前还需增加身份认证、RBAC、租户隔离、参数化场景 DSL、查询超时和 AST 级策略。旧 `/api/query` 在迁移期仍存在，不应对公网开放。

## 兼容与迁移

1. 新分析工作台只接入 `/api/v1`。
2. 旧页面继续使用原接口，直至功能逐项迁移并通过回归测试。
3. 完成迁移后，下线旧通用查询接口和后端内置 Mock 回退。

## 场景错误语义

- 参数缺失或越界返回 `422`。
- NebulaGraph 执行失败返回 `502`，不得以 HTTP 200 的空图或 Mock 数据冒充成功。
- 正常执行即使没有命中数据也返回 `200` 和空 `nodes/edges`，并保留 `traceId` 供审计定位。
