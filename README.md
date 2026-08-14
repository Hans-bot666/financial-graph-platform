# Financial Graph Platform

面向金融机构的图谱建模、探索分析与图特征编排平台。项目采用 React + AntV G6 构建可视化工作台，FastAPI 提供受控图查询、场景分析和特征定义服务，NebulaGraph 保存业务图数据。

## 已实现能力

- 场景看板：创建、编辑、删除看板，保存探索结果和 SVG 缩略图。
- 模型构建：可视化创建点、边和属性，拖拽连边，多 Schema 与版本发布。
- 数据接入：维护 CSV、MySQL、Hive、Oracle、Kafka、MaxCompute 数据源配置草稿。
- 探索分析：点查询、1-N 跳展开、路径查找、场景模板、只读 GQL、布局切换、路径高亮、实体属性和名单研判。
- 特征工厂：带类型端口的算子编排、DAG 校验、路径/过滤/聚合 IR 编译、输出目的地和特征生命周期配置。
- 后端安全：实体/边白名单、有界跳数、只读查询策略、结果上限、参数化特征查询模板。

当前数据接入连接器、特征调度执行器、在线特征服务和平台元数据库尚未实现。相关页面不会伪造运行成功；看板、Schema、数据源配置及部分治理状态当前保存在浏览器本地存储中。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite、Tailwind CSS、AntV G6、Radix UI |
| 后端 | Python 3.11、FastAPI、Pydantic、nebula3-python |
| 图数据库 | NebulaGraph 3.x |
| 部署 | Docker、Docker Compose、Nginx |

## 目录结构

```text
financial-graph-platform/
├── backend/
│   ├── app/api/v1/           # v1 API
│   ├── app/services/         # 探索、场景、特征编译服务
│   ├── tests/                # 后端自动化测试
│   ├── schema.ngql           # 图空间和 Schema
│   ├── seed.ngql             # 示例数据
│   └── requirements.txt
├── frontend/
│   ├── src/pages/            # 五个业务模块
│   ├── src/services/         # API 和本地状态仓储
│   └── package.json
├── docs/                     # 架构、API、特征工厂和接入设计
├── docker-compose.yml
└── .env.example
```

## 环境要求

- Node.js 20+，推荐 22
- pnpm 9+
- Python 3.11+
- NebulaGraph 3.x
- 可选：Docker 24+ 与 Docker Compose v2
- 初始化数据库时需要 `nebula-console` 或 NebulaGraph Studio

## 一、本地开发启动

### 1. 启动 NebulaGraph

可使用 NebulaGraph 官方 Docker Compose 项目：

```bash
git clone https://github.com/vesoft-inc/nebula-docker-compose.git
cd nebula-docker-compose
docker compose up -d
```

默认连接参数：

```text
Host: 127.0.0.1
Port: 9669
User: root
Password: nebula
Space: anti_fraud_kg
```

生产环境必须修改默认密码，并限制 Graph Service 端口的网络访问。

### 2. 初始化 Schema 和示例数据

数据库刚启动后请等待 Storage 与 Meta 服务就绪，再执行：

```bash
cd backend

nebula-console -addr 127.0.0.1 -port 9669 \
  -u root -p nebula -f schema.ngql

# Schema 建立后等待心跳同步，再导入数据
nebula-console -addr 127.0.0.1 -port 9669 \
  -u root -p nebula -f seed.ngql
```

如果本机没有 `nebula-console`，可在 NebulaGraph Studio 中依次执行 `schema.ngql` 和 `seed.ngql`。

### 3. 启动后端

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export NEBULA_HOST=127.0.0.1
export NEBULA_PORT=9669
export NEBULA_USER=root
export NEBULA_PASSWORD=nebula
export NEBULA_SPACE=anti_fraud_kg

uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

验证：

```bash
curl http://127.0.0.1:8000/api/v1/health
```

- OpenAPI：<http://127.0.0.1:8000/docs>
- API 基址：<http://127.0.0.1:8000/api/v1>

### 4. 启动前端

打开另一个终端：

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

访问终端显示的地址，默认是 <http://127.0.0.1:5173>。

## 二、Docker Compose 部署

仓库内的 Compose 启动前端和后端，NebulaGraph 使用已经部署的实例。

```bash
cp .env.example .env
```

修改 `.env`。Docker Desktop 访问宿主机 NebulaGraph 时可保留：

```dotenv
NEBULA_HOST=host.docker.internal
NEBULA_PORT=9669
NEBULA_USER=root
NEBULA_PASSWORD=请修改
NEBULA_SPACE=anti_fraud_kg
```

Linux 服务器上应将 `NEBULA_HOST` 改为 NebulaGraph 的内网地址或 Compose 服务名。

启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

访问：

- 平台：<http://127.0.0.1:8080>
- 后端：<http://127.0.0.1:8000/docs>

停止：

```bash
docker compose down
```

## 三、生产部署建议

1. 将前端 Nginx 和 FastAPI 部署到内网 Kubernetes 或虚拟机。
2. 后端至少运行两个实例，并在入口网关配置健康检查 `/api/v1/health`。
3. NebulaGraph 使用多副本集群；Graph、Meta、Storage 端口不暴露公网。
4. 密码放入 Vault/Kubernetes Secret，不提交 `.env`。
5. 将当前浏览器本地仓储迁移到 PostgreSQL，并增加租户、RBAC、审批和审计。
6. 只读 GQL 入口仍需在生产网关增加身份认证、速率限制和查询审计。
7. 配置 HTTPS、CSP、日志脱敏、依赖扫描、备份与恢复演练。

## 使用方法

### 首页看板

1. 点击“新建场景”创建看板。
2. 点击看板中的新增入口进入探索分析。
3. 查询出图后选择“保存到看板”。
4. 首页可查看缩略图，并重新打开已保存子图。

### 模型构建

1. 新建 Schema。
2. 在画布添加点类型，配置标签、颜色、主键和属性。
3. 从一个点的连接柄拖到另一个点创建边。
4. 编辑边名称、方向和属性。
5. 校验后发布版本。发布版本不可原地修改。

### 数据接入

当前可创建、编辑和删除数据源配置草稿。连接测试、元数据发现、字段映射和调度必须等真实连接器后端接入后使用。

### 探索分析

1. 选择分析图实例。
2. 使用点查询定位实体。
3. 选中节点后可查看实体属性、风险值和名单命中状态。
4. 使用当前节点进行多跳展开，或设为路径起点/终点。
5. 路径结果可高亮，画布支持力导向、环形和树状布局。
6. 高级用户可在 GQL 控制台执行受限只读查询。

### 特征工厂

1. 将实体、路径、过滤、聚合、逻辑、算法、输出算子拖入画布。
2. 按端口类型连接；不兼容端口会被拒绝。
3. 在右侧配置每个算子的参数。
4. 输出算子可配置写回图、外部存储、探索展示或 API 特征。
5. 保存草稿，执行校验和编译预览。
6. 在特征目录管理版本、API 登记、上下线和 Cron 调度配置。

调度和输出执行器尚未实现，目录中的配置不会伪造实际任务成功。

## 测试与构建

后端：

```bash
cd backend
source .venv/bin/activate
python -m unittest discover -s tests -v
```

前端：

```bash
cd frontend
pnpm typecheck
pnpm lint
pnpm build
```

## 常见问题

### 顶部显示“未连接”

确认后端已启动，并检查：

```bash
curl http://127.0.0.1:8000/api/v1/health
```

如果 `database` 为 `unavailable`，检查 NebulaGraph 地址、账号、密码、Space 和端口连通性。

### 查询没有节点

- 确认已执行 `seed.ngql`。
- 确认后端连接的是 `anti_fraud_kg`。
- 示例实体 ID 可使用 `c1`。
- 名称查询时必须选择正确实体类型。

### 前端请求地址错误

本地开发修改 `frontend/.env`：

```dotenv
VITE_GRAPH_API_BASE_URL=http://127.0.0.1:8000
```

Docker 构建时使用同源 `/api`，由 Nginx 转发到后端。

## 文档

- [平台架构](docs/architecture.md)
- [API v1 契约](docs/api-contract-v1.md)
- [企业级融合路线](docs/enterprise-platform-integration-plan.md)
- [Schema 与数据接入设计](docs/schema-and-ingestion-design.md)
- [企业级特征工厂方案](docs/enterprise-feature-factory-plan.md)

## License

本仓库暂未声明开源许可证。私有部署和使用范围由仓库所有者管理。
